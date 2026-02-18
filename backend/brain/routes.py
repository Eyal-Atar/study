"""Brain routes: generate roadmap, brain chat, regenerate schedule."""

import json
import os
from fastapi import APIRouter, Depends, HTTPException
from server.database import get_db
from auth.utils import get_current_user
from brain.schemas import BrainMessage

router = APIRouter()


@router.post("/generate-roadmap")
async def generate_roadmap(current_user: dict = Depends(get_current_user)):
    from brain.exam_brain import ExamBrain

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
    valid_exam_ids = set(exam_ids)
    placeholders = ",".join("?" * len(exam_ids))

    # Delete schedule_blocks first (FK to tasks without CASCADE)
    old_task_ids = [
        r["id"] for r in db.execute(
            f"SELECT id FROM tasks WHERE exam_id IN ({placeholders})", exam_ids
        ).fetchall()
    ]
    if old_task_ids:
        task_ph = ",".join("?" * len(old_task_ids))
        db.execute(f"DELETE FROM schedule_blocks WHERE task_id IN ({task_ph})", old_task_ids)

    db.execute(f"DELETE FROM tasks WHERE exam_id IN ({placeholders})", exam_ids)
    db.commit()

    # Run the AI Brain
    brain = ExamBrain(current_user, exam_list)
    ai_tasks = await brain.analyze_all_exams()

    # Save tasks — validate exam_ids from AI response
    saved_tasks = []
    for task in ai_tasks:
        task_exam_id = task.get("exam_id")
        if task_exam_id not in valid_exam_ids:
            if len(valid_exam_ids) == 1:
                task_exam_id = exam_ids[0]
            else:
                continue

        cursor = db.execute(
            """INSERT INTO tasks (user_id, exam_id, title, topic, subject,
               deadline, day_date, sort_order, estimated_hours, difficulty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, task_exam_id, task["title"], task.get("topic"),
             task.get("subject"), task.get("deadline"),
             task.get("day_date"), task.get("sort_order", 0),
             task.get("estimated_hours", 2.0), task.get("difficulty", 3))
        )
        saved_tasks.append({**task, "exam_id": task_exam_id, "id": cursor.lastrowid, "status": "pending"})
    db.commit()
    db.close()

    return {
        "message": f"Generated roadmap for {len(exams)} exams with {len(saved_tasks)} study tasks",
        "tasks": saved_tasks,
        "schedule": [],
    }


@router.post("/regenerate-schedule")
def regenerate_schedule(current_user: dict = Depends(get_current_user)):
    """Return current calendar tasks (kept for backward compat)."""
    user_id = current_user["id"]
    db = get_db()

    tasks = db.execute(
        """SELECT t.*, e.name as exam_name FROM tasks t
           LEFT JOIN exams e ON t.exam_id = e.id
           WHERE t.user_id = ? AND t.status != 'done'
           ORDER BY t.day_date, t.sort_order""",
        (user_id,)
    ).fetchall()
    db.close()

    if not tasks:
        return {"tasks": [], "schedule": [], "message": "All tasks completed!"}

    return {"tasks": [dict(t) for t in tasks], "schedule": []}


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
        WHERE t.user_id = ? ORDER BY t.day_date, t.sort_order
    """, (user_id,)).fetchall()

    exams_summary = "\n".join([
        f"- Exam #{e['id']}: {e['name']} ({e['subject']}) on {e['exam_date']}"
        + (f" | Special needs: {e['special_needs']}" if e['special_needs'] else "")
        for e in exams
    ])

    tasks_summary = "\n".join([
        f"- [{t['day_date']}] Task #{t['id']} [exam_id={t['exam_id']}] \"{t['title']}\" | "
        f"{t['estimated_hours']}h | difficulty={t['difficulty']} | status={t['status']}"
        for t in tasks
    ])

    prompt = f"""You are the study planning brain for a student. Here is their current day-by-day calendar:

EXAMS:
{exams_summary}

CURRENT CALENDAR (tasks by day):
{tasks_summary}

The student says: "{body.message}"

Based on their request, output an updated day-by-day calendar as JSON. You can:
- Change estimated_hours, difficulty, day_date for existing tasks
- Add new tasks (with day_date and sort_order)
- Remove tasks (don't include them)
- Reorganize the calendar

Rules:
- Keep task IDs for existing tasks you want to keep (use "id" field)
- For NEW tasks, set "id" to null
- Every task must have: id, exam_id, title, topic, subject, day_date, sort_order, estimated_hours, difficulty
- exam_id MUST be one of: {', '.join(str(e['id']) for e in exams)}
- day_date format: YYYY-MM-DD
- sort_order: ordering within a day (1, 2, 3...)
- Match the language of existing tasks
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
        max_tokens=8000,
        messages=[{"role": "user", "content": prompt}]
    )

    response_text = message.content[0].text.strip()
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        response_text = response_text.rsplit("```", 1)[0]

    result = json.loads(response_text)
    brain_reply = result.get("brain_reply", "Calendar updated.")
    new_tasks = result.get("tasks", [])

    # Replace pending tasks
    exam_ids = [e["id"] for e in exams]
    valid_exam_ids = set(exam_ids)
    if exam_ids:
        placeholders = ",".join("?" * len(exam_ids))

        old_task_ids = [
            r["id"] for r in db.execute(
                f"SELECT id FROM tasks WHERE exam_id IN ({placeholders}) AND status != 'done'",
                exam_ids
            ).fetchall()
        ]
        if old_task_ids:
            task_ph = ",".join("?" * len(old_task_ids))
            db.execute(f"DELETE FROM schedule_blocks WHERE task_id IN ({task_ph})", old_task_ids)

        db.execute(
            f"DELETE FROM tasks WHERE exam_id IN ({placeholders}) AND status != 'done'",
            exam_ids
        )
        db.commit()

    saved_tasks = []
    for task in new_tasks:
        if task.get("status") == "done":
            continue
        task_exam_id = task.get("exam_id")
        if task_exam_id not in valid_exam_ids:
            if len(valid_exam_ids) == 1:
                task_exam_id = exam_ids[0]
            else:
                continue
        cursor = db.execute(
            """INSERT INTO tasks (user_id, exam_id, title, topic, subject,
               deadline, day_date, sort_order, estimated_hours, difficulty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, task_exam_id, task["title"], task.get("topic"),
             task.get("subject"), task.get("day_date"),
             task.get("day_date"), task.get("sort_order", 0),
             task.get("estimated_hours", 2.0), task.get("difficulty", 3))
        )
        saved_tasks.append({**task, "exam_id": task_exam_id, "id": cursor.lastrowid, "status": "pending"})
    db.commit()
    db.close()

    return {
        "brain_reply": brain_reply,
        "tasks": saved_tasks,
        "schedule": [],
    }
