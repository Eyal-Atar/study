"""Brain routes: generate roadmap, brain chat, regenerate schedule."""

import json
import os
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException
from server.database import get_db
from auth.utils import get_current_user
from brain.schemas import BrainMessage, RegenerateDeltaRequest

router = APIRouter()


def rollover_tasks(db, user_id, tz_offset):
    """Move incomplete tasks from the past to today."""
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc - timedelta(minutes=tz_offset or 0)
    today_str = local_now.strftime("%Y-%m-%d")

    db.execute(
        """UPDATE tasks
           SET day_date = ?, is_delayed = 1
           WHERE user_id = ? AND status != 'done' AND day_date < ?""",
        (today_str, user_id, today_str)
    )
    return today_str


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

    # 1. Clear old tasks and schedule blocks for these exams
    exam_ids = [e["id"] for e in exams]
    valid_exam_ids = set(exam_ids)
    placeholders = ",".join("?" * len(exam_ids))

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

    # 2. Run the AI Brain to get new tasks
    brain = ExamBrain(current_user, exam_list)
    ai_tasks = await brain.analyze_all_exams()

    # 3. Save new tasks
    for task in ai_tasks:
        task_exam_id = task.get("exam_id")
        if task_exam_id not in valid_exam_ids:
            if len(valid_exam_ids) == 1:
                task_exam_id = list(valid_exam_ids)[0]
            else:
                continue

        db.execute(
            """INSERT INTO tasks (user_id, exam_id, title, topic, subject,
               deadline, day_date, sort_order, estimated_hours, difficulty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, task_exam_id, task["title"], task.get("topic"),
             task.get("subject"), task.get("day_date"),
             task.get("day_date"), task.get("sort_order", 0),
             task.get("estimated_hours", 2.0), task.get("difficulty", 3))
        )

    db.commit()

    # 4. Global preparation for scheduler
    rollover_tasks(db, user_id, current_user.get("timezone_offset"))
    db.commit()
    
    all_pending_tasks_rows = db.execute(
        "SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY day_date, sort_order",
        (user_id,)
    ).fetchall()
    all_pending_tasks = [dict(t) for t in all_pending_tasks_rows]

    # 5. Run Hourly Scheduler
    from brain.scheduler import generate_multi_exam_schedule
    schedule = generate_multi_exam_schedule(current_user, exam_list, all_pending_tasks)

    # 6. Save new schedule blocks
    # Clear ALL old schedule blocks for this user before saving regenerated ones
    db.execute("DELETE FROM schedule_blocks WHERE user_id = ?", (user_id,))
    
    for block in schedule:
        db_task_id = block.task_id if block.block_type != "hobby" else None
        db.execute(
            """INSERT INTO schedule_blocks (user_id, task_id, exam_id, exam_name, task_title, start_time, end_time, day_date, block_type, is_delayed)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, db_task_id, block.exam_id, block.exam_name, block.task_title, block.start_time, block.end_time, block.day_date, block.block_type, 1 if block.is_delayed else 0)
        )
        if db_task_id and block.is_delayed:
            db.execute("UPDATE tasks SET is_delayed = 1 WHERE id = ?", (db_task_id,))
    
    db.commit()
    db.close()

    return {
        "message": f"Generated roadmap with {len(all_pending_tasks)} tasks and {len(schedule)} hourly blocks",
        "tasks": all_pending_tasks,
        "schedule": [block.model_dump() for block in schedule],
    }


@router.post("/regenerate-schedule")
def regenerate_schedule(current_user: dict = Depends(get_current_user)):
    from server.config import DB_PATH
    print(f"DEBUG: regenerate_schedule for user {current_user['id']} using DB {DB_PATH}")
    """Return current calendar tasks + schedule blocks."""
    user_id = current_user["id"]
    db = get_db()

    tasks_rows = db.execute(
        """SELECT t.*, e.name as exam_name FROM tasks t
           LEFT JOIN exams e ON t.exam_id = e.id
           WHERE t.user_id = ?
           ORDER BY t.day_date, t.sort_order""",
        (user_id,)
    ).fetchall()
    tasks = [dict(t) for t in tasks_rows]
    
    schedule_rows = db.execute(
        "SELECT * FROM schedule_blocks WHERE user_id = ? ORDER BY day_date, start_time",
        (user_id,)
    ).fetchall()
    schedule = [dict(s) for s in schedule_rows]
    print(f"DEBUG: Returning {len(tasks)} tasks and {len(schedule)} schedule blocks for user {user_id}")
    
    db.close()

    if not tasks and not schedule:
        return {"tasks": [], "schedule": [], "message": "All tasks completed!"}

    return {
        "tasks": tasks,
        "schedule": schedule
    }


@router.post("/regenerate-delta")
async def regenerate_delta(body: RegenerateDeltaRequest, current_user: dict = Depends(get_current_user)):
    """Token-efficient delta schedule regeneration.

    Fetches next 14 days of schedule blocks, builds a compressed pipe-delimited
    snapshot, sends to Claude with a delta-only system prompt, parses the response,
    and surgically updates ONLY auto-generated FLX blocks that the AI says moved.
    FIX blocks (exams) and manually-edited blocks (is_manually_edited=1) are never touched.
    """
    import anthropic
    import re
    from datetime import datetime, timedelta, timezone

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="AI features require an API key")

    user_id = current_user["id"]
    db = get_db()

    # 1. Fetch next 14 days of schedule blocks
    now_utc = datetime.now(timezone.utc)
    tz_offset = current_user.get("timezone_offset", 0) or 0
    local_now = now_utc - timedelta(minutes=tz_offset)
    today_str = local_now.strftime("%Y-%m-%d")
    window_end_str = (local_now + timedelta(days=14)).strftime("%Y-%m-%d")

    blocks_rows = db.execute(
        """SELECT sb.id, sb.task_id, sb.block_type, sb.is_manually_edited,
                  sb.start_time, sb.end_time, sb.day_date, sb.completed,
                  e.status as exam_status
           FROM schedule_blocks sb
           LEFT JOIN exams e ON sb.exam_id = e.id
           WHERE sb.user_id = ?
             AND sb.day_date >= ? AND sb.day_date <= ?
             AND sb.completed = 0
           ORDER BY sb.day_date, sb.start_time""",
        (user_id, today_str, window_end_str)
    ).fetchall()

    blocks = [dict(b) for b in blocks_rows]

    if not blocks:
        db.close()
        raise HTTPException(status_code=400, detail="No upcoming schedule blocks found. Generate a roadmap first.")

    # 2. Build compressed pipe-delimited snapshot
    # Format: [BlockID]|[Type]|[Status]|[Day][StartTime]-[EndTime]
    # Type: FIX = exam/class block (never move), FLX = study/hobby (can move)
    # Status: M = manually edited (preserve), A = auto-generated (AI can move)
    snapshot_lines = []
    for b in blocks:
        # Skip break blocks entirely
        if b["block_type"] in ("break",):
            continue

        if b["block_type"] == "hobby":
            block_type_flag = "FLX"
        else:
            # Study block: FIX only if it's an exam-day marker (no task_id and exam_status=upcoming)
            block_type_flag = "FLX"  # All study blocks in this system are flexible

        status_flag = "M" if b["is_manually_edited"] else "A"

        # Parse day and time from start_time (ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
        start_str = b["start_time"]
        end_str = b["end_time"]
        try:
            start_dt = datetime.fromisoformat(start_str)
            end_dt = datetime.fromisoformat(end_str)
            day_part = start_dt.strftime("%a")  # Mon, Tue, etc.
            start_time_part = start_dt.strftime("%H:%M")
            end_time_part = end_dt.strftime("%H:%M")
        except (ValueError, TypeError):
            day_part = b.get("day_date", "")
            start_time_part = start_str[-8:-3] if len(start_str) >= 8 else start_str
            end_time_part = end_str[-8:-3] if len(end_str) >= 8 else end_str

        snapshot_lines.append(
            f"{b['id']}|{block_type_flag}|{status_flag}|{day_part}{start_time_part}-{end_time_part}"
        )

    snapshot = ";".join(snapshot_lines)

    # 3. Build AI prompt
    system_prompt = """You are a schedule optimizer. You receive a compressed snapshot of a student's upcoming schedule and a reason for a constraint change. Your job is to output ONLY the delta — the blocks that need to move.

HARD RULES:
1. NEVER change blocks with Status M (manually edited by user). Skip them entirely.
2. NEVER change blocks with Type FIX (fixed events like exams). Skip them entirely.
3. Only output blocks that ACTUALLY need to move. Do NOT output unchanged blocks.
4. Do NOT output full JSON. Use the exact response format below.

Response format (first line is reasoning, then one delta line per moved block):
Reasoning: [1 sentence explaining the shift]
[BlockID]:[NewDay][NewStart]-[NewEnd]

Example:
Reasoning: Moved study sessions earlier to accommodate the new exam date.
42:Mon09:00-11:00
57:Tue14:00-16:00

If no blocks need to move, respond with:
Reasoning: No changes needed — the current schedule already accommodates the constraint.
"""

    user_message = f"""Schedule snapshot (next 14 days):
{snapshot}

Reason for regeneration: {body.reason}

Output the delta using the format above. Remember: only output blocks that ACTUALLY need to move."""

    # 4. Call Claude API
    client = anthropic.Anthropic(api_key=api_key)
    try:
        message = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=1000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}]
        )
        response_text = message.content[0].text.strip()
    except Exception as e:
        db.close()
        raise HTTPException(status_code=500, detail=f"AI call failed: {str(e)}")

    # 5. Parse delta response
    lines = response_text.strip().split("\n")
    reasoning = ""
    delta_updates = []

    for line in lines:
        line = line.strip()
        if line.startswith("Reasoning:"):
            reasoning = line[len("Reasoning:"):].strip()
        elif re.match(r"^\d+:", line):
            # Parse: BlockID:DayHH:MM-HH:MM
            match = re.match(r"^(\d+):([A-Za-z]{3})(\d{2}:\d{2})-(\d{2}:\d{2})$", line)
            if match:
                block_id = int(match.group(1))
                day_abbr = match.group(2)
                new_start_time = match.group(3)
                new_end_time = match.group(4)
                delta_updates.append({
                    "block_id": block_id,
                    "day_abbr": day_abbr,
                    "new_start_time": new_start_time,
                    "new_end_time": new_end_time
                })

    # 6. Build a day abbreviation -> date mapping for the next 14 days
    # We need to convert day abbreviations back to actual dates
    day_to_date = {}
    for i in range(15):
        d = local_now + timedelta(days=i)
        abbr = d.strftime("%a")
        if abbr not in day_to_date:
            day_to_date[abbr] = d.strftime("%Y-%m-%d")

    # 7. Build a set of valid block IDs (FLX + A only) from our snapshot
    valid_update_ids = {
        b["id"] for b in blocks
        if not b["is_manually_edited"]  # Status A only
        # All blocks in our snapshot are FLX (we excluded FIX above)
    }

    # 8. Surgically update ONLY allowed blocks
    updated_count = 0
    for delta in delta_updates:
        block_id = delta["block_id"]

        # Safety check: skip if not in our valid set
        if block_id not in valid_update_ids:
            continue

        new_date = day_to_date.get(delta["day_abbr"])
        if not new_date:
            continue

        new_start_iso = f"{new_date}T{delta['new_start_time']}:00"
        new_end_iso = f"{new_date}T{delta['new_end_time']}:00"

        db.execute(
            """UPDATE schedule_blocks
               SET start_time = ?, end_time = ?, day_date = ?
               WHERE id = ? AND user_id = ? AND is_manually_edited = 0""",
            (new_start_iso, new_end_iso, new_date, block_id, user_id)
        )
        # Sync the task's day_date too if applicable
        block_row = db.execute(
            "SELECT task_id FROM schedule_blocks WHERE id = ? AND user_id = ?",
            (block_id, user_id)
        ).fetchone()
        if block_row and block_row["task_id"]:
            db.execute(
                "UPDATE tasks SET day_date = ? WHERE id = ? AND user_id = ?",
                (new_date, block_row["task_id"], user_id)
            )
        updated_count += 1

    db.commit()

    # 9. Return updated schedule for frontend to re-render
    schedule_rows = db.execute(
        "SELECT * FROM schedule_blocks WHERE user_id = ? ORDER BY day_date, start_time",
        (user_id,)
    ).fetchall()
    schedule = [dict(s) for s in schedule_rows]

    tasks_rows = db.execute(
        "SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY day_date, sort_order",
        (user_id,)
    ).fetchall()
    tasks = [dict(t) for t in tasks_rows]

    db.close()

    return {
        "reasoning": reasoning,
        "blocks_updated": updated_count,
        "tasks": tasks,
        "schedule": schedule,
    }


@router.get("/schedule")
def get_schedule(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    db = get_db()
    blocks = db.execute(
        "SELECT * FROM schedule_blocks WHERE user_id = ? ORDER BY day_date, start_time",
        (user_id,)
    ).fetchall()
    db.close()
    return [dict(b) for b in blocks]


@router.post("/brain-chat")
async def brain_chat(body: BrainMessage, current_user: dict = Depends(get_current_user)):
    import anthropic

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=400, detail="AI features require an API key")

    user_id = current_user["id"]
    db = get_db()

    exams_rows = db.execute(
        "SELECT * FROM exams WHERE user_id = ? AND status = 'upcoming' ORDER BY exam_date",
        (user_id,)
    ).fetchall()
    exams = [dict(e) for e in exams_rows]

    tasks_rows = db.execute("""
        SELECT t.*, e.name as exam_name FROM tasks t
        LEFT JOIN exams e ON t.exam_id = e.id
        WHERE t.user_id = ? ORDER BY t.day_date, t.sort_order
    """, (user_id,)).fetchall()
    tasks = [dict(t) for t in tasks_rows]

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

    prompt = f"""You are the study planning brain for a university student. Here is their current day-by-day calendar:

EXAMS:
{exams_summary}

CURRENT CALENDAR (tasks by day):
{tasks_summary}

The student says: "{body.message}"

Based on their request, output an updated day-by-day calendar as JSON. 

CRITICAL RULES:
1. SINGLE FOCUS RULE: Each day MUST focus on ONE exam only to minimize context switching. Do not mix exams on the same day unless absolutely necessary for deadlines.
2. SIMULATION-FIRST TEMPLATE: When scheduling intense study for an exam (especially the final 5 days), always use this chronological flow:
   A. Full Simulation (Morning).
   B. Deep Review (תחקיר) of simulation mistakes.
   C. Targeted weakness practice.
3. SPECIFICITY: Keep tasks specific and actionable.
4. LANGUAGE: Match the language of existing tasks (Hebrew/English).

You can:
- Change estimated_hours, difficulty, day_date for existing tasks
- Add new tasks (with day_date and sort_order)
- Remove tasks (don't include them)
- Reorganize the calendar

Return ONLY valid JSON. No explanation.

Rules for JSON:
- Keep task IDs for existing tasks you want to keep (use "id" field)
- For NEW tasks, set "id" to null
- Every task must have: id, exam_id, title, topic, subject, day_date, sort_order, estimated_hours, difficulty
- exam_id MUST be one of: {', '.join(str(e['id']) for e in exams)}
- day_date format: YYYY-MM-DD
- sort_order: ordering within a day (1, 2, 3...)

Also include a short "brain_reply" message to the student explaining what you changed.

Return format:
{{
  "brain_reply": "I reorganized your week to focus on one exam per day and added simulation blocks.",
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

    for task in new_tasks:
        if task.get("status") == "done":
            continue
        task_exam_id = task.get("exam_id")
        if task_exam_id not in valid_exam_ids:
            if len(valid_exam_ids) == 1:
                task_exam_id = list(valid_exam_ids)[0]
            else:
                continue
        db.execute(
            """INSERT INTO tasks (user_id, exam_id, title, topic, subject,
               deadline, day_date, sort_order, estimated_hours, difficulty)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, task_exam_id, task["title"], task.get("topic"),
             task.get("subject"), task.get("day_date"),
             task.get("day_date"), task.get("sort_order", 0),
             task.get("estimated_hours", 2.0), task.get("difficulty", 3))
        )

    db.commit()

    # Roll over past tasks and fetch all current pending tasks
    rollover_tasks(db, user_id, current_user.get("timezone_offset"))
    db.commit()
    
    all_pending_tasks_rows = db.execute(
        "SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY day_date, sort_order",
        (user_id,)
    ).fetchall()
    all_pending_tasks = [dict(t) for t in all_pending_tasks_rows]

    # Run Hourly Scheduler
    from brain.scheduler import generate_multi_exam_schedule
    schedule = generate_multi_exam_schedule(current_user, exams, all_pending_tasks)

    # Save schedule blocks
    # Clear ALL old schedule blocks for this user before saving regenerated ones
    db.execute("DELETE FROM schedule_blocks WHERE user_id = ?", (user_id,))
    
    for block in schedule:
        db_task_id = block.task_id if block.block_type != "hobby" else None
        db.execute(
            """INSERT INTO schedule_blocks (user_id, task_id, exam_id, exam_name, task_title, start_time, end_time, day_date, block_type, is_delayed)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_id, db_task_id, block.exam_id, block.exam_name, block.task_title, block.start_time, block.end_time, block.day_date, block.block_type, 1 if block.is_delayed else 0)
        )
        if db_task_id and block.is_delayed:
            db.execute("UPDATE tasks SET is_delayed = 1 WHERE id = ?", (db_task_id,))
    
    db.commit()
    db.close()

    return {
        "brain_reply": brain_reply,
        "tasks": all_pending_tasks,
        "schedule": [block.model_dump() for block in schedule],
    }
