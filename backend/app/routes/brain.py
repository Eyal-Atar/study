"""Brain routes: generate roadmap, brain chat, regenerate schedule."""

import json
import os
from fastapi import APIRouter, Depends, HTTPException
from app.database import get_db
from app.auth import get_current_user
from app.schemas import BrainMessage
from app.services.scheduler import generate_multi_exam_schedule

router = APIRouter()


@router.post("/generate-roadmap")
async def generate_roadmap(current_user: dict = Depends(get_current_user)):
    from app.services.exam_brain import ExamBrain

    user_id = current_user["id"]
    db = get_db()

    exams = db.execute(
        "SELECT * FROM exams WHERE user_id = ? AND status = 'upcoming' ORDER BY exam_date",
        (user_id,)
    ).fetchall()
    if not exams:
        db.close()
        raise HTTPException(status_code=400, detail="No upcoming exams found. Add exams first!")

    exam_list = []
    for exam in exams:
        files = db.execute(
            "SELECT * FROM exam_files WHERE exam_id = ?", (exam["id"],)
        ).fetchall()
        exam_list.append({**dict(exam), "files": [dict(f) for f in files]})

    # Clear old tasks for these exams
    exam_ids = [e["id"] for e in exams]
    placeholders = ",".join("?" * len(exam_ids))
    db.execute(f"DELETE FROM tasks WHERE exam_id IN ({placeholders})", exam_ids)
    db.commit()

    # Run the AI Brain
    brain = ExamBrain(current_user, exam_list)
    ai_tasks = await brain.analyze_all_exams()

    # Save tasks
    saved_tasks = []
    for task in ai_tasks:
        cursor = db.execute(
            """INSERT INTO tasks (user_id, exam_id, title, topic, subject,
               deadline, estimated_hours, difficulty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, task["exam_id"], task["title"], task.get("topic"),
             task.get("subject"), task.get("deadline"),
             task.get("estimated_hours", 2.0), task.get("difficulty", 3))
        )
        saved_tasks.append({**task, "id": cursor.lastrowid, "status": "pending"})
    db.commit()

    # Generate schedule
    all_tasks = db.execute(
        "SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY deadline",
        (user_id,)
    ).fetchall()
    db.close()

    schedule = generate_multi_exam_schedule(
        current_user, [dict(e) for e in exams], [dict(t) for t in all_tasks]
    )
    return {
        "message": f"Generated roadmap for {len(exams)} exams with {len(saved_tasks)} study tasks",
        "tasks": saved_tasks,
        "schedule": [s.model_dump() for s in schedule],
    }


@router.post("/regenerate-schedule")
def regenerate_schedule(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    db = get_db()

    exams = db.execute(
        "SELECT * FROM exams WHERE user_id = ? AND status = 'upcoming' ORDER BY exam_date",
        (user_id,)
    ).fetchall()
    tasks = db.execute(
        "SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY deadline",
        (user_id,)
    ).fetchall()
    db.close()

    if not tasks:
        return {"schedule": [], "message": "All tasks completed!"}

    schedule = generate_multi_exam_schedule(
        current_user, [dict(e) for e in exams], [dict(t) for t in tasks]
    )
    return {"schedule": [s.model_dump() for s in schedule]}


@router.post("/brain-chat")
async def brain_chat(body: BrainMessage, current_user: dict = Depends(get_current_user)):
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="AI features require an API key")

    user_id = current_user["id"]
    db = get_db()

    exams = db.execute(
        "SELECT * FROM exams WHERE user_id = ? AND status = 'upcoming' ORDER BY exam_date",
        (user_id,)
    ).fetchall()

    tasks = db.execute("""
        SELECT t.*, e.name as exam_name FROM tasks t
        LEFT JOIN exams e ON t.exam_id = e.id
        WHERE t.user_id = ? ORDER BY t.deadline
    """, (user_id,)).fetchall()

    exams_summary = "\n".join([
        f"- Exam #{e['id']}: {e['name']} ({e['subject']}) on {e['exam_date']}"
        + (f" | Special needs: {e['special_needs']}" if e['special_needs'] else "")
        for e in exams
    ])

    tasks_summary = "\n".join([
        f"- Task #{t['id']} [exam_id={t['exam_id']}] \"{t['title']}\" | "
        f"{t['estimated_hours']}h | difficulty={t['difficulty']} | status={t['status']}"
        for t in tasks
    ])

    prompt = f"""You are the study planning brain for a student. Here is their current setup:

EXAMS:
{exams_summary}

CURRENT TASKS:
{tasks_summary}

The student says: "{body.message}"

Based on their request, output an updated task list as JSON. You can:
- Change estimated_hours for existing tasks
- Change difficulty ratings
- Add new tasks
- Remove tasks (don't include them)
- Change deadlines

Rules:
- Keep task IDs for existing tasks you want to keep (use "id" field)
- For NEW tasks, set "id" to null
- Every task must have: id, exam_id, title, topic, subject, deadline, estimated_hours, difficulty
- Return ONLY valid JSON. No explanation.

Also include a short "brain_reply" message to the student explaining what you changed.

Return format:
{{
  "brain_reply": "I increased eigenvalues study time by 2 hours and added a practice session.",
  "tasks": [...]
}}"""

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-5-20250929",
        max_tokens=3000,
        messages=[{"role": "user", "content": prompt}]
    )

    response_text = message.content[0].text.strip()
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        response_text = response_text.rsplit("```", 1)[0]

    result = json.loads(response_text)
    brain_reply = result.get("brain_reply", "Schedule updated.")
    new_tasks = result.get("tasks", [])

    # Replace pending tasks
    exam_ids = [e["id"] for e in exams]
    if exam_ids:
        placeholders = ",".join("?" * len(exam_ids))
        db.execute(
            f"DELETE FROM tasks WHERE exam_id IN ({placeholders}) AND status != 'done'",
            exam_ids
        )
        db.commit()

    saved_tasks = []
    for task in new_tasks:
        if task.get("status") == "done":
            continue
        cursor = db.execute(
            """INSERT INTO tasks (user_id, exam_id, title, topic, subject,
               deadline, estimated_hours, difficulty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, task["exam_id"], task["title"], task.get("topic"),
             task.get("subject"), task.get("deadline"),
             task.get("estimated_hours", 2.0), task.get("difficulty", 3))
        )
        saved_tasks.append({**task, "id": cursor.lastrowid, "status": "pending"})
    db.commit()

    # Regenerate schedule
    all_tasks = db.execute(
        "SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY deadline",
        (user_id,)
    ).fetchall()

    schedule = generate_multi_exam_schedule(
        current_user, [dict(e) for e in exams], [dict(t) for t in all_tasks]
    )
    db.close()

    return {
        "brain_reply": brain_reply,
        "tasks": saved_tasks,
        "schedule": [s.model_dump() for s in schedule],
    }
