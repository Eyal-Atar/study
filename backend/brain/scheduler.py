"""
Multi-Exam Study Scheduler with hourly slots and timezone support.
Strict Deadline-First approach with overflow handling.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from brain.schemas import ScheduleBlock

EXCLUSIVE_ZONE_DAYS = 4


def generate_multi_exam_schedule(
    user: dict,
    exams: list[dict],
    tasks: list[dict],
) -> list[ScheduleBlock]:
    """
    Generates a granular hourly schedule.
    Uses Deadline-First allocation and marks overflow as delayed.
    All times in UTC ISO 8601 'Z'.
    """
    if not tasks:
        return []

    # User preferences
    session_min = user.get("session_minutes", 50)
    break_min = user.get("break_minutes", 10)
    study_method = user.get("study_method", "pomodoro")
    neto_study_hours = user.get("neto_study_hours", 4.0)
    peak_productivity = user.get("peak_productivity", "Morning")
    tz_offset = user.get("timezone_offset", 0)  # in minutes

    wake_h, wake_m = map(int, user.get("wake_up_time", "08:00").split(":"))
    sleep_h, sleep_m = map(int, user.get("sleep_time", "23:00").split(":"))

    # 'Today' in user's local time (start of day)
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc - timedelta(minutes=tz_offset)
    today_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Exam lookup
    exam_map = {e["id"]: e for e in exams}
    exam_deadlines = {e["id"]: e["exam_date"] for e in exams}
    
    # Task state
    remaining = {t["id"]: t.get("estimated_hours", 1.0) for t in tasks}

    # Range: today to 60 days max or last exam
    last_exam_date_str = max(exam_deadlines.values()) if exam_deadlines else today_local.strftime("%Y-%m-%d")
    last_exam_date = datetime.fromisoformat(last_exam_date_str).replace(hour=23, minute=59)
    total_days = max(1, (last_exam_date.date() - today_local.date()).days + 1)
    
    schedule = []

    # Prepare pool of tasks sorted by AI-assigned day, then exam (Single Focus), then sort order
    pool = sorted(tasks, key=lambda t: (
        t.get("day_date", "9999-12-31"),
        t.get("exam_id", 0),
        t.get("sort_order", 0)
    ))

    for day_offset in range(min(total_days + 14, 60)): # Add 2 week buffer for overflow
        day_local = today_local + timedelta(days=day_offset)
        day_str = day_local.strftime("%Y-%m-%d")

        # Study window for the day (Local)
        win_start_local = day_local.replace(hour=wake_h, minute=wake_m) + timedelta(minutes=30)
        
        # Handle midnight sleep_time
        actual_sleep_h = sleep_h if sleep_h != 0 else 24
        win_end_local = day_local.replace(hour=0, minute=0) + timedelta(hours=actual_sleep_h) - timedelta(hours=1)
        
        if win_start_local >= win_end_local:
            continue

        # Available study minutes for this day capped by neto_study_hours
        day_limit_min = min(neto_study_hours * 60, (win_end_local - win_start_local).total_seconds() / 60)
        
        # ── HOBBY ALLOCATION ──
        hobby_duration = 60 # 1 hour
        hobby_start_local = None
        if peak_productivity == "Morning":
            hobby_start_local = win_end_local - timedelta(minutes=hobby_duration + 30)
        elif peak_productivity == "Evening":
            hobby_start_local = win_start_local + timedelta(minutes=30)
        else: # Afternoon or other
            hobby_start_local = win_start_local + timedelta(minutes=30)
        
        hobby_end_local = hobby_start_local + timedelta(minutes=hobby_duration)

        # ── TASK ALLOCATION ──
        current_time_local = win_start_local
        used_study_min = 0
        
        # Insert hobby block for this day
        schedule.append(ScheduleBlock(
            task_id=None, exam_id=None, exam_name="Relax",
            task_title=user.get("hobby_name") or "Hobby",
            subject="Hobby",
            start_time=(hobby_start_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
            end_time=(hobby_end_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
            day_date=day_str, block_type="hobby", is_delayed=False
        ))

        # Filter pool for tasks assigned to this day OR delayed tasks
        day_tasks = [t for t in pool if t.get("day_date") <= day_str and remaining[t["id"]] > 0]

        for task in day_tasks:
            if remaining[task["id"]] <= 0:
                continue

            # Stop if day limit reached or window closed
            if used_study_min >= day_limit_min or current_time_local >= win_end_local:
                break

            eid = task.get("exam_id")
            ename = exam_map[eid]["name"] if eid in exam_map else "General"
            is_delayed = task.get("day_date") < day_str

            # Accumulate all contiguous sessions for this task into a single block.
            # When the hobby block interrupts, emit the current segment and start a new one
            # after the hobby. This guarantees at most ONE schedule_block per task per
            # contiguous study segment — preventing the "two blocks toggle at once" bug
            # that occurred when querySelectorAll matched multiple blocks for the same task_id.
            task_block_start_local = None
            task_block_end_local = None

            def _emit_task_block():
                """Emit the accumulated block if one is in progress."""
                nonlocal task_block_start_local, task_block_end_local
                if task_block_start_local is not None and task_block_end_local is not None:
                    schedule.append(ScheduleBlock(
                        task_id=task["id"], exam_id=eid, exam_name=ename,
                        task_title=task["title"], subject=task.get("subject"),
                        start_time=(task_block_start_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
                        end_time=(task_block_end_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
                        day_date=day_str, block_type="study", is_delayed=is_delayed
                    ))
                task_block_start_local = None
                task_block_end_local = None

            while remaining[task["id"]] > 0 and used_study_min < day_limit_min and current_time_local < win_end_local:
                # 1. Check for hobby overlap and skip if needed
                if current_time_local < hobby_end_local and (current_time_local + timedelta(minutes=1)) > hobby_start_local:
                    # Hobby interrupts — emit what we have so far, then skip past hobby
                    _emit_task_block()
                    current_time_local = hobby_end_local
                    if current_time_local >= win_end_local: break
                    continue # Re-check day_limit after skip

                # 2. Calculate session duration
                min_until_hobby = (hobby_start_local - current_time_local).total_seconds() / 60 if current_time_local < hobby_start_local else 9999
                min_until_sleep = (win_end_local - current_time_local).total_seconds() / 60

                duration_min = min(
                    session_min,
                    remaining[task["id"]] * 60,
                    day_limit_min - used_study_min,
                    min_until_hobby if min_until_hobby > 0 else 9999,
                    min_until_sleep
                )

                if duration_min < 5:
                    if current_time_local < hobby_start_local:
                        _emit_task_block()
                        current_time_local = hobby_end_local
                        continue
                    else:
                        break # End day

                end_time_local = current_time_local + timedelta(minutes=duration_min)

                # Extend the running block for this task (or start a new one)
                if task_block_start_local is None:
                    task_block_start_local = current_time_local
                task_block_end_local = end_time_local

                remaining[task["id"]] -= duration_min / 60
                used_study_min += duration_min
                current_time_local = end_time_local

            # Emit any remaining accumulated block for this task
            _emit_task_block()

        if all(v <= 0 for v in remaining.values()):
            break

    return schedule
