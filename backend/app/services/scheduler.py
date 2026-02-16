"""
Multi-Exam Study Scheduler with exclusive exam zones.

Key rule: When an exam is within EXCLUSIVE_ZONE_DAYS (4 days),
100% of study time goes to that exam only.
"""

from datetime import datetime, timedelta
from collections import defaultdict
from app.schemas import ScheduleBlock

EXCLUSIVE_ZONE_DAYS = 4
MAX_DAILY_STUDY_HOURS = 6  # Cap per day to spread work across days


def generate_multi_exam_schedule(
    user: dict,
    exams: list[dict],
    tasks: list[dict],
) -> list[ScheduleBlock]:
    if not tasks or not exams:
        return []

    session_min = user.get("session_minutes", 50)
    break_min = user.get("break_minutes", 10)
    study_method = user.get("study_method", "pomodoro")

    wake_h, wake_m = map(int, user.get("wake_up_time", "08:00").split(":"))
    sleep_h, sleep_m = map(int, user.get("sleep_time", "23:00").split(":"))

    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)

    # Build exam lookup
    exam_map = {e["id"]: e for e in exams}
    exam_dates = {}
    for e in exams:
        try:
            exam_dates[e["id"]] = datetime.fromisoformat(e["exam_date"])
        except (ValueError, TypeError):
            continue

    # Group tasks by exam
    tasks_by_exam = defaultdict(list)
    for t in tasks:
        eid = t.get("exam_id") or 0
        if eid in exam_map or eid == 0:
            tasks_by_exam[eid].append(t)

    # Track remaining hours per task
    remaining = {t["id"]: t.get("estimated_hours", 1.0) for t in tasks}

    # Calculate total remaining hours per exam to spread evenly
    total_hours_by_exam = defaultdict(float)
    for t in tasks:
        total_hours_by_exam[t.get("exam_id") or 0] += t.get("estimated_hours", 1.0)

    # Schedule range: today to last exam
    if not exam_dates:
        return []
    last_exam = max(exam_dates.values())
    total_days = max(1, (last_exam - today).days + 1)

    schedule = []

    for day_offset in range(min(total_days, 60)):
        day = today + timedelta(days=day_offset)
        day_str = day.strftime("%Y-%m-%d")

        # Study window for the day
        study_start = day.replace(hour=wake_h, minute=wake_m) + timedelta(hours=1)
        study_end = day.replace(hour=sleep_h, minute=sleep_m) - timedelta(hours=2)
        if study_start >= study_end:
            continue

        # Which exams are still active (not yet passed)?
        active_exams = [
            eid for eid, edate in exam_dates.items()
            if edate >= day
        ]
        if not active_exams:
            continue

        # ── EXCLUSIVE ZONE LOGIC ──
        exams_in_zone = []
        for eid in active_exams:
            days_until = (exam_dates[eid] - day).days
            if 0 <= days_until <= EXCLUSIVE_ZONE_DAYS:
                exams_in_zone.append((eid, days_until))

        if exams_in_zone:
            exams_in_zone.sort(key=lambda x: x[1])
            focus_exam_id = exams_in_zone[0][0]
            days_until_focus = exams_in_zone[0][1]

            if days_until_focus == 0:
                study_end = min(study_end, study_start + timedelta(hours=2))
                scheduled_exams = [focus_exam_id]
            elif days_until_focus <= 1:
                scheduled_exams = [focus_exam_id]
            else:
                if len(exams_in_zone) > 1 and exams_in_zone[1][1] <= 2:
                    scheduled_exams = [exams_in_zone[0][0], exams_in_zone[1][0]]
                else:
                    scheduled_exams = [focus_exam_id]
        else:
            scheduled_exams = active_exams

        # Calculate weights
        weights = {}
        for eid in scheduled_exams:
            days_until = max(1, (exam_dates[eid] - day).days)
            has_tasks = any(remaining.get(t["id"], 0) > 0 for t in tasks_by_exam.get(eid, []))
            if not has_tasks:
                continue
            if len(scheduled_exams) == 1:
                weights[eid] = 1.0
            else:
                weights[eid] = 1.0 / (days_until ** 0.5)

        if not weights:
            continue

        total_weight = sum(weights.values())
        proportions = {eid: w / total_weight for eid, w in weights.items()}

        # Available minutes — capped at MAX_DAILY_STUDY_HOURS
        window_min = (study_end - study_start).total_seconds() / 60
        available_min = min(window_min, MAX_DAILY_STUDY_HOURS * 60)

        # For each exam, calculate daily cap: spread remaining hours evenly across remaining days
        exam_minutes = {}
        for eid, prop in proportions.items():
            days_left = max(1, (exam_dates[eid] - day).days)
            remaining_hrs = sum(remaining.get(t["id"], 0) for t in tasks_by_exam.get(eid, []))
            # Spread evenly: remaining_hours / days_left, but at most their proportion of available
            daily_target = (remaining_hrs / days_left) * 60  # in minutes
            allocated = available_min * prop
            exam_minutes[eid] = min(allocated, daily_target + 30)  # 30 min buffer

        # Cap the study end time to respect daily max
        capped_end = min(study_end, study_start + timedelta(minutes=available_min + (available_min / session_min) * break_min))

        sorted_exams = sorted(weights.keys(), key=lambda eid: -weights[eid])

        current_time = study_start
        used_minutes = defaultdict(float)
        max_rounds = 30

        for _ in range(max_rounds):
            if current_time >= capped_end:
                break
            made_progress = False

            for eid in sorted_exams:
                if current_time >= capped_end:
                    break
                if used_minutes[eid] >= exam_minutes.get(eid, 0):
                    continue

                exam_tasks = [
                    t for t in tasks_by_exam.get(eid, [])
                    if remaining.get(t["id"], 0) > 0
                ]
                if not exam_tasks:
                    continue

                exam_tasks.sort(key=lambda t: (
                    t.get("deadline") or "9999-12-31",
                    -(t.get("difficulty", 3))
                ))

                task = exam_tasks[0]
                exam = exam_map.get(eid, {})

                block_min = min(
                    session_min,
                    remaining[task["id"]] * 60,
                    (capped_end - current_time).total_seconds() / 60,
                    exam_minutes.get(eid, 0) - used_minutes[eid]
                )

                if block_min < 10:
                    continue

                end_time = current_time + timedelta(minutes=block_min)
                schedule.append(ScheduleBlock(
                    task_id=task["id"],
                    exam_id=eid,
                    exam_name=exam.get("name", ""),
                    task_title=task["title"],
                    subject=task.get("subject") or exam.get("subject"),
                    start_time=current_time.isoformat(),
                    end_time=end_time.isoformat(),
                    day_date=day_str,
                    block_type="study",
                ))

                remaining[task["id"]] -= block_min / 60
                used_minutes[eid] += block_min
                current_time = end_time
                made_progress = True

                # Add break
                if study_method == "pomodoro":
                    break_end = current_time + timedelta(minutes=break_min)
                    if break_end <= capped_end:
                        schedule.append(ScheduleBlock(
                            task_id=task["id"],
                            exam_id=eid,
                            exam_name=exam.get("name", ""),
                            task_title="Break",
                            subject=None,
                            start_time=current_time.isoformat(),
                            end_time=break_end.isoformat(),
                            day_date=day_str,
                            block_type="break",
                        ))
                        current_time = break_end

            if not made_progress:
                break

        if all(v <= 0 for v in remaining.values()):
            break

    return schedule
