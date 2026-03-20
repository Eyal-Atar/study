"""Brain routes: generate roadmap, brain chat, regenerate schedule."""

import json
import os
import shutil
import asyncio
import fitz  # PyMuPDF
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, UploadFile, File, Form
from server.database import get_db
from server.config import UPLOAD_DIR
from auth.utils import get_current_user, verify_csrf_token
from brain.schemas import BrainMessage, RegenerateDeltaRequest
from users.schemas import UserOnboardRequest, OnboardExam
from notifications.utils import send_to_user

router = APIRouter(dependencies=[Depends(verify_csrf_token)])


@router.post("/onboard")
async def onboard_user(
    onboard_data: str = Form(...),
    files: List[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Unified onboarding: update profile, create exams, upload files, and run Auditor."""
    from brain.exam_brain import ExamBrain
    import traceback

    user_id = current_user["id"]
    db = get_db()
    
    try:
        # 1. Parse data
        try:
            data = UserOnboardRequest.model_validate_json(onboard_data)
        except Exception as e:
            print(f"DEBUG: onboard_data parsing failed: {e}")
            raise HTTPException(status_code=422, detail=f"Invalid onboarding data: {str(e)}")

        # 2. Update user profile
        db.execute(
            """UPDATE users SET 
               name = COALESCE(?, name), wake_up_time = ?, sleep_time = ?, study_method = ?,
               session_minutes = ?, break_minutes = ?, hobby_name = ?,
               neto_study_hours = ?, study_hours_preference = ?, buffer_days = ?,
               timezone_offset = ?, onboarding_completed = 1
               WHERE id = ?""",
            (
                data.name,
                data.wake_up_time,
                data.sleep_time,
                data.study_method,
                data.session_minutes,
                data.break_minutes,
                data.hobby_name,
                data.neto_study_hours,
                data.study_hours_preference,
                data.buffer_days,
                data.timezone_offset,
                user_id
            )
        )

        # 3. Fresh start: Clear existing exams/tasks for this user
        db.execute("DELETE FROM schedule_blocks WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM tasks WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM exams WHERE user_id = ?", (user_id,))

        # 4. Create exams and link files
        created_exams = []
        files = files or []
        
        buffer_days = data.buffer_days or 0
        for exam_data in data.exams:
            # Validate exam date is far enough in the future for buffer
            try:
                exam_dt = datetime.strptime(exam_data.exam_date, "%Y-%m-%d").date()
                today = datetime.now(timezone.utc).date()
                if exam_dt < today:
                    print(f"WARNING: exam '{exam_data.name}' date {exam_data.exam_date} is in the past, adjusting to tomorrow")
                    exam_data.exam_date = (today + timedelta(days=1)).strftime("%Y-%m-%d")
            except (ValueError, TypeError):
                pass  # Let it through, scheduler will handle gracefully

            cursor = db.execute(
                """INSERT INTO exams (user_id, name, subject, exam_date, special_needs)
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, exam_data.name, exam_data.subject, exam_data.exam_date, exam_data.special_needs)
            )
            exam_id = cursor.lastrowid
            
            # Handle files for this exam
            for i, file_idx in enumerate(exam_data.file_indices):
                if file_idx < 0 or file_idx >= len(files):
                    print(f"WARNING: file_idx {file_idx} out of range (0-{len(files)-1}) for exam '{exam_data.name}', skipping")
                    continue
                
                upload_file = files[file_idx]
                # Validate file type
                allowed_extensions = ('.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp')
                if upload_file.filename and not upload_file.filename.lower().endswith(allowed_extensions):
                    print(f"WARNING: Unsupported file type '{upload_file.filename}' for exam '{exam_data.name}', skipping")
                    continue
                file_type = exam_data.file_types[i] if i < len(exam_data.file_types) else 'other'

                # Save file
                user_dir = os.path.join(UPLOAD_DIR, f"user_{user_id}")
                os.makedirs(user_dir, exist_ok=True)
                # Use a safe filename or prefix with exam_id to avoid collisions
                safe_filename = f"exam_{exam_id}_{upload_file.filename}"
                file_path = os.path.join(user_dir, safe_filename)
                
                with open(file_path, "wb") as buffer:
                    shutil.copyfileobj(upload_file.file, buffer)

                # Extract text
                extracted_text = ""
                if upload_file.filename.lower().endswith(".pdf"):
                    extracted_text = ExamBrain.extract_pdf_text(file_path)

                try:
                    db.execute(
                        """INSERT INTO exam_files (exam_id, filename, file_path, file_type, file_size, extracted_text)
                           VALUES (?, ?, ?, ?, ?, ?)""",
                        (exam_id, upload_file.filename, file_path, file_type, os.path.getsize(file_path), extracted_text)
                    )
                except Exception:
                    # Clean up orphaned file if DB insert fails
                    if os.path.exists(file_path):
                        os.remove(file_path)
                    raise

            # Fetch the newly created exam
            new_exam = db.execute("SELECT * FROM exams WHERE id = ?", (exam_id,)).fetchone()
            created_exams.append(dict(new_exam))

        db.commit()
        
        # 5. Trigger Initial Roadmap Generation (Auditor)
        updated_user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        
        # Prepare exam list with files for ExamBrain
        exam_list_for_brain = []
        for exam in created_exams:
            files_rows = db.execute("SELECT * FROM exam_files WHERE exam_id = ?", (exam["id"],)).fetchall()
            exam_list_for_brain.append({**exam, "files": [dict(f) for f in files_rows]})
            
        brain = ExamBrain(dict(updated_user), exam_list_for_brain)
        auditor_result = await brain.call_split_brain()
        
        # Persist Auditor draft
        draft_json = json.dumps({
            "tasks": auditor_result["tasks"],
            "gaps": auditor_result["gaps"],
            "topic_map": auditor_result["topic_map"],
        })
        exam_ids = [e["id"] for e in created_exams]
        if exam_ids:
            placeholders = ",".join("?" * len(exam_ids))
            db.execute(
                f"UPDATE exams SET auditor_draft = ? WHERE id IN ({placeholders})",
                [draft_json] + exam_ids,
            )
            db.commit()

        print(f"DEBUG: onboard_user success for user {user_id}")
        return {
            "message": "Onboarding complete! Roadmap generated.",
            "tasks": auditor_result["tasks"],
            "gaps": auditor_result["gaps"],
            "topic_map": auditor_result["topic_map"],
        }

    except Exception as e:
        if db: db.rollback()
        print(f"ERROR in onboard_user for user {user_id}:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if db: db.close()


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
    """Step 1 of Split-Brain: run the Auditor, persist the draft, return Auditor output."""
    from brain.exam_brain import ExamBrain
    import traceback

    user_id = current_user["id"]
    db = get_db()
    print(f"DEBUG: generate-roadmap called for user {user_id}")

    try:
        exams = db.execute(
            "SELECT * FROM exams WHERE user_id = ? AND status = 'upcoming' ORDER BY exam_date",
            (user_id,)
        ).fetchall()
        if not exams:
            db.close()
            raise HTTPException(status_code=400, detail="No upcoming exams found. Add exams first!")

        exam_list = []
        # Batch fetch all exam files to avoid N+1 query
        exam_ids_list = [exam["id"] for exam in exams]
        all_files = db.execute(
            f"SELECT * FROM exam_files WHERE exam_id IN ({','.join('?' * len(exam_ids_list))})",
            exam_ids_list
        ).fetchall()
        files_by_exam = {}
        for f in all_files:
            files_by_exam.setdefault(f["exam_id"], []).append(dict(f))
        for exam in exams:
            exam_list.append({**dict(exam), "files": files_by_exam.get(exam["id"], [])})

        exam_ids = [e["id"] for e in exams]

        # Run the Auditor (API Call 1) — does NOT clear tasks or schedule blocks
        brain = ExamBrain(current_user, exam_list)
        auditor_result = await brain.call_split_brain()

        # Persist Auditor draft to all exams for this user so the review page survives refresh
        draft_json = json.dumps({
            "tasks": auditor_result["tasks"],
            "gaps": auditor_result["gaps"],
            "topic_map": auditor_result["topic_map"],
        })
        placeholders = ",".join("?" * len(exam_ids))
        db.execute(
            f"UPDATE exams SET auditor_draft = ? WHERE id IN ({placeholders})",
            [draft_json] + exam_ids,
        )
        db.commit()
        db.close()

        print(f"DEBUG: generate-roadmap success for user {user_id}")
        return {
            "message": f"Auditor complete — {len(auditor_result['tasks'])} tasks, {len(auditor_result['gaps'])} gaps detected",
            "tasks": auditor_result["tasks"],
            "gaps": auditor_result["gaps"],
            "topic_map": auditor_result["topic_map"],
        }
    except Exception as e:
        if db: db.close()
        print(f"ERROR in generate-roadmap for user {user_id}:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/auditor-draft")
def get_auditor_draft(current_user: dict = Depends(get_current_user)):
    """Retrieve the stored Auditor draft for the current user.

    Returns the first non-null auditor_draft found in the user's upcoming exams.
    The draft is a JSON blob containing tasks, gaps, and topic_map as produced by
    the Auditor (POST /brain/generate-roadmap). The frontend uses this to re-render
    the Intermediate Review Page after a page refresh.
    """
    user_id = current_user["id"]
    db = get_db()

    row = db.execute(
        """SELECT auditor_draft FROM exams
           WHERE user_id = ? AND status = 'upcoming' AND auditor_draft IS NOT NULL
           ORDER BY exam_date
           LIMIT 1""",
        (user_id,),
    ).fetchone()
    db.close()

    if not row or not row["auditor_draft"]:
        raise HTTPException(status_code=404, detail="No Auditor draft found. Run generate-roadmap first.")

    try:
        draft = json.loads(row["auditor_draft"])
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Auditor draft is corrupted — please re-run generate-roadmap.")

    return draft


@router.delete("/auditor-draft")
def dismiss_auditor_draft(current_user: dict = Depends(get_current_user)):
    """Clear the stored Auditor draft so the resume-banner stops appearing."""
    user_id = current_user["id"]
    db = get_db()
    db.execute(
        "UPDATE exams SET auditor_draft = NULL WHERE user_id = ? AND status = 'upcoming'",
        (user_id,),
    )
    db.commit()
    db.close()
    return {"message": "Auditor draft dismissed"}


@router.post("/approve-and-schedule")
async def approve_and_schedule(body: dict, current_user: dict = Depends(get_current_user)):
    """Step 2 of Split-Brain: accept approved tasks, run Strategist + Enforcer, save schedule."""
    import traceback
    from brain.exam_brain import ExamBrain
    from brain.scheduler import generate_multi_exam_schedule

    user_id = current_user["id"]
    approved_tasks = body.get("approved_tasks", [])
    print(f"DEBUG: approve_and_schedule called for user {user_id} with {len(approved_tasks)} tasks")

    if not approved_tasks:
        raise HTTPException(status_code=400, detail="approved_tasks must be a non-empty list")

    db = get_db()

    # Load the user's upcoming exams
    exams = db.execute(
        "SELECT * FROM exams WHERE user_id = ? AND status = 'upcoming' ORDER BY exam_date",
        (user_id,)
    ).fetchall()
    if not exams:
        db.close()
        raise HTTPException(status_code=400, detail="No upcoming exams found.")

    exam_list = [dict(e) for e in exams]
    exam_ids = [e["id"] for e in exams]

    # 1. Run Strategist (API Call 2) — assigns day_index and internal_priority
    brain = ExamBrain(current_user, exam_list)
    try:
        scheduled_tasks = await brain.call_strategist(approved_tasks)
    except Exception as exc:
        db.close()
        print(f"ERROR: Strategist call failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Strategist call failed: {str(exc)}")

    # 2. Convert day_index → actual date string (day_index 0 = today)
    now_utc = datetime.now(timezone.utc)
    tz_offset = current_user.get("timezone_offset", 0) or 0
    local_now = now_utc - timedelta(minutes=tz_offset)
    today_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    try:
        for task in scheduled_tasks:
            day_idx = int(task.get("day_index", 0))
            task_date = today_local + timedelta(days=day_idx)
            task["day_date"] = task_date.strftime("%Y-%m-%d")

        # Sort by internal_priority descending within each day so higher-priority tasks fill first
        scheduled_tasks.sort(key=lambda t: (t.get("day_date", ""), -t.get("internal_priority", 50)))
    except Exception as exc:
        db.close()
        print(f"ERROR: Task scheduling/sorting failed: {exc}")
        raise HTTPException(status_code=500, detail=f"Task processing failed: {str(exc)}")

    # 3. DB Transaction for atomicity
    try:
        db.execute("BEGIN TRANSACTION")

        # Clear existing tasks and schedule_blocks for this user
        # Delete all blocks and tasks for this user (full regeneration)
        db.execute("DELETE FROM schedule_blocks WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM tasks WHERE user_id = ?", (user_id,))

        # 4. Save new tasks to the tasks table
        valid_exam_ids = {e["id"] for e in exams}
        fallback_exam_id = exam_list[0]["id"] if exam_list else None

        # Map AI task_index -> DB id for dependency resolution
        ai_index_to_db_id = {}
        
        # Temporary list to hold task objects before dependency update
        to_insert = []

        # Pass 1: Insert tasks
        for idx, task in enumerate(scheduled_tasks):
            exam_id = task.get("exam_id")
            if exam_id not in valid_exam_ids:
                exam_id = fallback_exam_id
            if exam_id is None:
                continue

            focus_score = max(1, min(10, int(task.get("focus_score", 5))))
            is_padding = 1 if task.get("is_padding") else 0
            
            cursor = db.execute(
                """INSERT INTO tasks
                (user_id, exam_id, title, topic, subject, deadline, day_date,
                    sort_order, estimated_hours, focus_score, is_padding)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    user_id,
                    exam_id,
                    task.get("title", "Study Task"),
                    task.get("topic", ""),
                    task.get("subject", ""),
                    task.get("day_date"),
                    task.get("day_date"),
                    task.get("sort_order", 0),
                    max(0.5, min(6.0, float(task.get("estimated_hours", 1.0)))),
                    focus_score,
                    is_padding,
                ),
            )
            db_id = cursor.lastrowid
            ai_idx = task.get("task_index", idx)
            ai_index_to_db_id[ai_idx] = db_id

        # Pass 2: Update dependencies
        for task in scheduled_tasks:
            ai_idx = task.get("task_index")
            ai_dep_idx = task.get("dependency_id")
            if ai_idx is not None and ai_dep_idx is not None:
                db_id = ai_index_to_db_id.get(ai_idx)
                db_dep_id = ai_index_to_db_id.get(ai_dep_idx)
                if db_id and db_dep_id:
                    db.execute("UPDATE tasks SET dependency_id = ? WHERE id = ?", (db_dep_id, db_id))
        
        # Reload all saved tasks to pass to the scheduler (they are now in the DB but transaction not committed)
        saved_tasks = [
            dict(r) for r in db.execute("SELECT * FROM tasks WHERE user_id = ?", (user_id,)).fetchall()
        ]

        # 5. Run the Python Enforcer (generate_multi_exam_schedule)
        schedule = generate_multi_exam_schedule(current_user, exam_list, saved_tasks, start_buffer_hours=2.0)

        # 6. Save schedule blocks
        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        for block in schedule:
            db_task_id = block.task_id if block.block_type != "hobby" else None
            is_notified = 1 if block.start_time < now_iso else 0
            db.execute(
                """INSERT INTO schedule_blocks
                (user_id, task_id, exam_id, exam_name, task_title,
                    start_time, end_time, day_date, block_type,
                    is_delayed, is_split, part_number, total_parts, push_notified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    user_id,
                    db_task_id,
                    block.exam_id,
                    block.exam_name,
                    block.task_title,
                    block.start_time,
                    block.end_time,
                    block.day_date,
                    block.block_type,
                    1 if block.is_delayed else 0,
                    block.is_split,
                    block.part_number,
                    block.total_parts,
                    is_notified,
                ),
            )
            if db_task_id:
                db.execute("UPDATE tasks SET day_date = ? WHERE id = ?", (block.day_date, db_task_id))

        # 7. Sync task dates with actual schedule
        # First, reset all tasks assigned to Today to Tomorrow if they have no blocks today
        # This prevents "orphan" tasks in the Focus tab when it's too late to study.
        today_str = local_now.strftime("%Y-%m-%d")
        tomorrow_str = (local_now + timedelta(days=1)).strftime("%Y-%m-%d")
        
        # Get IDs of tasks that HAVE blocks scheduled for today
        scheduled_today_task_ids = [
            r["task_id"] for r in db.execute(
                "SELECT DISTINCT task_id FROM schedule_blocks WHERE user_id = ? AND day_date = ?",
                (user_id, today_str)
            ).fetchall() if r["task_id"] is not None
        ]
        
        # Update any task assigned to today that isn't in that list
        if scheduled_today_task_ids:
            placeholders = ",".join("?" * len(scheduled_today_task_ids))
            db.execute(
                f"UPDATE tasks SET day_date = ? WHERE user_id = ? AND day_date = ? AND id NOT IN ({placeholders})",
                (tomorrow_str, user_id, today_str, *scheduled_today_task_ids)
            )
        else:
            db.execute(
                "UPDATE tasks SET day_date = ? WHERE user_id = ? AND day_date = ?",
                (tomorrow_str, user_id, today_str)
            )

        # 8. Reload all saved tasks to ensure up-to-date day_date (synced from blocks) in response
        final_tasks = [
            dict(r) for r in db.execute("SELECT * FROM tasks WHERE user_id = ?", (user_id,)).fetchall()
        ]

        # Clear auditor_draft
        if exam_ids:
            placeholders = ",".join("?" * len(exam_ids))
            db.execute(
                f"UPDATE exams SET auditor_draft = NULL WHERE id IN ({placeholders})",
                exam_ids,
            )

        db.execute("COMMIT")
    except Exception as exc:
        db.execute("ROLLBACK")
        db.close()
        print(f"ERROR: approve_and_schedule failed: {exc}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Scheduling process failed: {str(exc)}")

    db.close()

    schedule_dicts = [block.model_dump() for block in schedule]
    return {
        "message": f"Schedule generated — {len(final_tasks)} tasks scheduled across {len(schedule_dicts)} blocks",
        "tasks": final_tasks,
        "schedule": schedule_dicts,
    }


@router.post("/regenerate-schedule")
def regenerate_schedule(current_user: dict = Depends(get_current_user)):
    """Re-run the Enforcer on existing tasks and return refreshed calendar data."""
    db = get_db()
    try:
        result = internal_regenerate_schedule(current_user["id"], current_user, db)
        return result
    finally:
        db.close()

def internal_regenerate_schedule(user_id: int, current_user: dict, db) -> dict:
    """Internal logic to re-run the Enforcer on existing tasks. 
    Does NOT close the DB connection.
    """
    from server.config import DB_PATH
    from brain.scheduler import generate_multi_exam_schedule
    import traceback
    import io, sys, threading
    from collections import Counter

    print(f"DEBUG: internal_regenerate_schedule for user {user_id}")

    tasks_rows = db.execute(
        """SELECT t.*, e.name as exam_name FROM tasks t
           LEFT JOIN exams e ON t.exam_id = e.id
           WHERE t.user_id = ? AND t.status != 'done'
           ORDER BY t.day_date, t.sort_order""",
        (user_id,)
    ).fetchall()
    all_tasks = [dict(t) for t in tasks_rows]

    # DEBUG: Log task distribution by day_date
    day_counts = Counter(t.get("day_date") for t in all_tasks)
    print(f"DEBUG REGEN: total={len(all_tasks)} tasks by day: {dict(sorted(day_counts.items()))}")

    if not all_tasks:
        schedule_rows = db.execute(
            "SELECT * FROM schedule_blocks WHERE user_id = ? ORDER BY day_date, start_time",
            (user_id,)
        ).fetchall()
        db.commit()  # Ensure any pending changes from caller are persisted
        return {"tasks": [], "schedule": [dict(s) for s in schedule_rows], "message": "All tasks completed!"}

    # Load exams for the scheduler
    exams_rows = db.execute(
        "SELECT * FROM exams WHERE user_id = ? AND status = 'upcoming' ORDER BY exam_date",
        (user_id,)
    ).fetchall()
    exam_list = [dict(e) for e in exams_rows]

    # Re-run the Enforcer on non-done tasks
    pending_tasks = [t for t in all_tasks if t.get("status") != "done"]
    
    _scheduler_log = io.StringIO()
    _old_stdout = sys.stdout
    _stdout_lock = getattr(sys, '_stdout_lock', None)
    if _stdout_lock is None:
        _stdout_lock = threading.Lock()
        sys._stdout_lock = _stdout_lock

    with _stdout_lock:
        sys.stdout = _scheduler_log
        try:
            new_schedule = generate_multi_exam_schedule(current_user, exam_list, pending_tasks, start_buffer_hours=0.0)
        finally:
            sys.stdout = _old_stdout
    
    _scheduler_output = _scheduler_log.getvalue()

    if new_schedule is None:
        print(f"WARNING: Scheduler returned None for user {user_id}. Returning existing schedule. Log: {_scheduler_output[:500]}")
        schedule_rows = db.execute(
            "SELECT * FROM schedule_blocks WHERE user_id = ? ORDER BY day_date, start_time",
            (user_id,)
        ).fetchall()
        db.commit()  # Persist caller changes even if scheduler fails
        return {"tasks": all_tasks, "schedule": [dict(s) for s in schedule_rows], "_scheduler_log": _scheduler_output, "_scheduler_warning": "Scheduler returned empty result; showing previous schedule."}

    # Replace schedule blocks in DB, preserving manually-edited blocks
    try:
        # Save manually-edited blocks before wiping the schedule.
        manually_edited_rows = db.execute(
            """SELECT * FROM schedule_blocks
               WHERE user_id = ? AND is_manually_edited = 1""",
            (user_id,)
        ).fetchall()
        manually_edited_blocks = [dict(r) for r in manually_edited_rows]
        manually_edited_task_ids = {b["task_id"] for b in manually_edited_blocks if b["task_id"]}

        db.execute("DELETE FROM schedule_blocks WHERE user_id = ?", (user_id,))

        now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

        for block in new_schedule:
            db_task_id = block.task_id if block.block_type != "hobby" else None
            if db_task_id and db_task_id in manually_edited_task_ids:
                continue
            is_notified = 1 if block.start_time < now_iso else 0
            db.execute(
                """INSERT INTO schedule_blocks
                (user_id, task_id, exam_id, exam_name, task_title,
                    start_time, end_time, day_date, block_type,
                    is_delayed, is_split, part_number, total_parts, push_notified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    user_id,
                    db_task_id,
                    block.exam_id,
                    block.exam_name,
                    block.task_title,
                    block.start_time,
                    block.end_time,
                    block.day_date,
                    block.block_type,
                    1 if block.is_delayed else 0,
                    block.is_split,
                    block.part_number,
                    block.total_parts,
                    is_notified,
                ),
            )
            # Sync task day_date with the first block found for it
            if db_task_id:
                db.execute("UPDATE tasks SET day_date = ? WHERE id = ?", (block.day_date, db_task_id))

        for b in manually_edited_blocks:
            is_notified = 1 if b["start_time"] < now_iso else 0
            db.execute(
                """INSERT INTO schedule_blocks
                (user_id, task_id, exam_id, exam_name, task_title,
                    start_time, end_time, day_date, block_type,
                    is_delayed, is_split, part_number, total_parts,
                    push_notified, is_manually_edited, completed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    user_id,
                    b["task_id"],
                    b["exam_id"],
                    b["exam_name"],
                    b["task_title"],
                    b["start_time"],
                    b["end_time"],
                    b["day_date"],
                    b["block_type"],
                    b["is_delayed"],
                    b["is_split"],
                    b["part_number"],
                    b["total_parts"],
                    is_notified,
                    1,
                    b["completed"],
                ),
            )

        db.commit()
    except Exception as exc:
        db.rollback()
        traceback.print_exc()
        raise exc

    final_schedule_rows = db.execute(
        "SELECT * FROM schedule_blocks WHERE user_id = ? ORDER BY day_date, start_time",
        (user_id,)
    ).fetchall()
    schedule_dicts = [dict(r) for r in final_schedule_rows]

    study_blocks_by_day = {}
    for b in schedule_dicts:
        if b.get("block_type") == "study" and b.get("task_id"):
            study_blocks_by_day[b["day_date"]] = study_blocks_by_day.get(b["day_date"], 0) + 1

    return {
        "tasks": all_tasks,
        "schedule": schedule_dicts,
        "_debug": {
            "total_tasks": len(all_tasks),
            "study_blocks_by_day": study_blocks_by_day,
            "scheduler_log": _scheduler_output,
        },
    }



@router.post("/regenerate-delta")
async def regenerate_delta(body: RegenerateDeltaRequest, current_user: dict = Depends(get_current_user)):
    """Token-efficient delta schedule regeneration.

    Fetches next 14 days of schedule blocks, builds a compressed pipe-delimited
    snapshot, sends to AI with a delta-only system prompt, parses the response,
    and surgically updates ONLY auto-generated FLX blocks that the AI says moved.
    FIX blocks (exams) and manually-edited blocks (is_manually_edited=1) are never touched.
    """
    import litellm
    import re
    from datetime import datetime, timedelta, timezone

    model = os.environ.get("LLM_MODEL", "openrouter/openai/gpt-4o-mini")
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

    # 4. Call AI API
    try:
        response = await litellm.acompletion(
            model=model,
            max_tokens=1000,
            temperature=0,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ]
        )
        response_text = response.choices[0].message.content.strip()
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
               SET start_time = ?, end_time = ?, day_date = ?, push_notified = 0
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
    import litellm

    model = os.environ.get("LLM_MODEL", "openrouter/openai/gpt-4o-mini")
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

    try:
        response = await litellm.acompletion(
            model=model,
            max_tokens=8192,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        response_text = response.choices[0].message.content.strip()
    except Exception as e:
        db.close()
        raise HTTPException(status_code=500, detail=f"AI call failed: {str(e)}")
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        response_text = response_text.rsplit("```", 1)[0]

    try:
        result = json.loads(response_text)
    except json.JSONDecodeError as exc:
        db.close()
        raise HTTPException(status_code=422, detail=f"AI returned invalid JSON: {str(exc)}")
    brain_reply = result.get("brain_reply", "Calendar updated.")
    new_tasks = result.get("tasks", [])

    # Replace pending tasks inside a transaction
    exam_ids = [e["id"] for e in exams]
    valid_exam_ids = set(exam_ids)

    try:
        db.execute("BEGIN TRANSACTION")

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
                db.execute(f"DELETE FROM schedule_blocks WHERE task_id IN ({task_ph}) AND is_manually_edited = 0", old_task_ids)

            db.execute(
                f"DELETE FROM tasks WHERE exam_id IN ({placeholders}) AND status != 'done'",
                exam_ids
            )

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
                   deadline, day_date, sort_order, estimated_hours, difficulty, is_padding)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user_id, task_exam_id, task["title"], task.get("topic"),
                 task.get("subject"), task.get("day_date"),
                 task.get("day_date"), task.get("sort_order", 0),
                 task.get("estimated_hours", 2.0), task.get("difficulty", 3),
                 1 if task.get("is_padding") else 0)
            )

        # Roll over past tasks
        rollover_tasks(db, user_id, current_user.get("timezone_offset"))

        all_pending_tasks_rows = db.execute(
            "SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY day_date, sort_order",
            (user_id,)
        ).fetchall()
        all_pending_tasks = [dict(t) for t in all_pending_tasks_rows]

        # Run Hourly Scheduler
        from brain.scheduler import generate_multi_exam_schedule
        schedule = generate_multi_exam_schedule(current_user, exams, all_pending_tasks, start_buffer_hours=0.0)

        # Preserve manually-edited blocks before wiping
        manually_edited_rows = db.execute(
            "SELECT * FROM schedule_blocks WHERE user_id = ? AND is_manually_edited = 1",
            (user_id,)
        ).fetchall()
        manually_edited_blocks = [dict(r) for r in manually_edited_rows]
        manually_edited_task_ids = {b["task_id"] for b in manually_edited_blocks if b["task_id"]}

        # Clear auto-generated schedule blocks
        db.execute("DELETE FROM schedule_blocks WHERE user_id = ? AND is_manually_edited = 0", (user_id,))

        now_iso = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

        for block in schedule:
            db_task_id = block.task_id if block.block_type != "hobby" else None
            if db_task_id and db_task_id in manually_edited_task_ids:
                continue

            is_notified = 1 if block.start_time < now_iso else 0

            db.execute(
                """INSERT INTO schedule_blocks (user_id, task_id, exam_id, exam_name, task_title,
                   start_time, end_time, day_date, block_type, is_delayed, is_split, part_number, total_parts, push_notified)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user_id, db_task_id, block.exam_id, block.exam_name, block.task_title,
                 block.start_time, block.end_time, block.day_date, block.block_type,
                 1 if block.is_delayed else 0, block.is_split, block.part_number, block.total_parts, is_notified)
            )
            if db_task_id:
                db.execute("UPDATE tasks SET day_date = ? WHERE id = ?", (block.day_date, db_task_id))
                if block.is_delayed:
                    db.execute("UPDATE tasks SET is_delayed = 1 WHERE id = ?", (db_task_id,))

        # Reload up-to-date tasks
        final_tasks_rows = db.execute(
            "SELECT * FROM tasks WHERE user_id = ? AND status != 'done' ORDER BY day_date, sort_order",
            (user_id,)
        ).fetchall()
        final_tasks = [dict(t) for t in final_tasks_rows]

        db.execute("COMMIT")
    except Exception as exc:
        db.execute("ROLLBACK")
        db.close()
        raise HTTPException(status_code=500, detail=f"Brain chat scheduling failed: {str(exc)}")

    # Notify user that roadmap is ready
    send_to_user(db, user_id, "הלוז עודכן! 🪄", "התוכנית שלך עודכנה על ידי המוח.", url="/")
    db.close()

    return {
        "brain_reply": brain_reply,
        "tasks": final_tasks,
        "schedule": [block.model_dump() for block in schedule],
    }
