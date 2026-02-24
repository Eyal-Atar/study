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
    neto_study_hours = user.get("neto_study_hours", 4.0)
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

    for day_offset in range(min(total_days + 14, 60)):  # Add 2 week buffer for overflow
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

        # ── DAY STATE ──
        current_time_local = win_start_local
        used_study_min = 0
        consecutive_study_min = 0
        hobby_scheduled_today = False
        hobby_duration = 60
        hobby_name = user.get("hobby_name") or "Hobby"
        short_break_min = 15
        long_break_min = 45

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
            is_simulation = (
                task.get("topic") == "Simulation"
                or "Simulation" in task.get("title", "")
                or "סימולציה" in task.get("title", "")
            )

            while remaining[task["id"]] > 0 and used_study_min < day_limit_min and current_time_local < win_end_local:
                min_until_sleep = (win_end_local - current_time_local).total_seconds() / 60

                # Simulations run uninterrupted — no session cap
                if is_simulation:
                    duration_min = min(
                        remaining[task["id"]] * 60,
                        day_limit_min - used_study_min,
                        min_until_sleep
                    )
                else:
                    duration_min = min(
                        session_min,
                        remaining[task["id"]] * 60,
                        day_limit_min - used_study_min,
                        min_until_sleep
                    )

                if duration_min < 5:
                    break

                end_time_local = current_time_local + timedelta(minutes=duration_min)

                # Emit study block
                schedule.append(ScheduleBlock(
                    task_id=task["id"], exam_id=eid, exam_name=ename,
                    task_title=task["title"], subject=task.get("subject"),
                    start_time=(current_time_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
                    end_time=(end_time_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
                    day_date=day_str, block_type="study", is_delayed=is_delayed
                ))

                # Update state
                consecutive_study_min += duration_min
                used_study_min += duration_min
                remaining[task["id"]] -= duration_min / 60
                current_time_local = end_time_local

                # Dynamic gaps & hobby (ghost gaps advance time without creating blocks)
                if current_time_local < win_end_local:
                    if is_simulation or consecutive_study_min >= 120:
                        if not hobby_scheduled_today:
                            hobby_start_local = current_time_local
                            hobby_end_local = hobby_start_local + timedelta(minutes=hobby_duration)
                            schedule.append(ScheduleBlock(
                                task_id=None, exam_id=None, exam_name="Relax",
                                task_title=hobby_name, subject="Hobby",
                                start_time=(hobby_start_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
                                end_time=(hobby_end_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
                                day_date=day_str, block_type="hobby", is_delayed=False
                            ))
                            current_time_local += timedelta(minutes=hobby_duration)
                            hobby_scheduled_today = True
                        else:
                            # Ghost gap: long break (food/rest) — no block emitted
                            current_time_local += timedelta(minutes=long_break_min)
                        consecutive_study_min = 0
                    else:
                        # Ghost gap: short break — no block emitted
                        current_time_local += timedelta(minutes=short_break_min)

        # End-of-day catch-up: hobby wasn't earned mid-session, insert at day's end
        if not hobby_scheduled_today:
            mins_remaining = (win_end_local - current_time_local).total_seconds() / 60
            if mins_remaining >= hobby_duration:
                hobby_start_local = win_end_local - timedelta(minutes=hobby_duration)
                hobby_end_local = win_end_local
                schedule.append(ScheduleBlock(
                    task_id=None, exam_id=None, exam_name="Relax",
                    task_title=hobby_name, subject="Hobby",
                    start_time=(hobby_start_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
                    end_time=(hobby_end_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat(),
                    day_date=day_str, block_type="hobby", is_delayed=False
                ))

        if all(v <= 0 for v in remaining.values()):
            break

    return schedule
