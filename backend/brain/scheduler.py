"""
Multi-Exam Study Scheduler with Deterministic Greedy-Fill.
Decouples task prioritization (AI) from time allocation (Python).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from brain.schemas import ScheduleBlock

PEAK_WINDOWS = {
    "Morning":   (6, 12),   # 06:00 - 12:00
    "Afternoon": (12, 17),  # 12:00 - 17:00
    "Evening":   (17, 22),  # 17:00 - 22:00
    "Night":     (21, 3),   # 21:00 - 03:00 (next day)
}


def _is_peak_window(window_start: datetime, peak_productivity: str) -> bool:
    """Return True if this time window overlaps the user's peak productivity hours."""
    peak_range = PEAK_WINDOWS.get(peak_productivity)
    if not peak_range:
        return False  # unknown value → treat all as non-peak
    peak_start_h, peak_end_h = peak_range
    window_h = window_start.hour
    if peak_start_h < peak_end_h:
        return peak_start_h <= window_h < peak_end_h
    else:
        # Wraps midnight (e.g. Night: 21-03)
        return window_h >= peak_start_h or window_h < peak_end_h


class WiredWindow:
    def __init__(self, start_local: datetime, end_local: datetime):
        self.start_local = start_local
        self.end_local = end_local
        self.capacity_min = (end_local - start_local).total_seconds() / 60

    def __repr__(self):
        return f"WiredWindow({self.start_local.strftime('%H:%M')}-{self.end_local.strftime('%H:%M')})"

def generate_multi_exam_schedule(
    user: dict,
    exams: list[dict],
    tasks: list[dict],
) -> list[ScheduleBlock]:
    """
    Generates a schedule by 'pouring' tasks into available time windows.
    Strictly deterministic and respects fixed breaks and neto study hours.
    """
    if not tasks:
        return []

    # User preferences
    neto_study_hours = user.get("neto_study_hours", 4.0)
    break_minutes = user.get("break_minutes", 10)
    tz_offset = user.get("timezone_offset", 0) or 0
    hobby_name = user.get("hobby_name") or "Hobby"
    peak_productivity = user.get("peak_productivity", "Morning") or "Morning"
    
    # 'Today' in user's local time
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc - timedelta(minutes=tz_offset)
    today_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Exam lookup
    exam_map = {e["id"]: e for e in exams}
    
    # Task state
    remaining_task_hours = {t["id"]: float(t.get("estimated_hours", 2.0)) for t in tasks}

    # Build a set of completed task IDs (for dependency ordering)
    completed_task_ids: set = set()

    def _dependency_satisfied(t: dict) -> bool:
        """Return True if the task's dependency has been started (or has none)."""
        dep_id = t.get("dependency_id")
        if dep_id is None:
            return True
        dep_task = next((x for x in tasks if x["id"] == dep_id), None)
        if dep_task is None:
            return True
        return dep_id in completed_task_ids or remaining_task_hours.get(dep_id, 0) < float(dep_task.get("estimated_hours", 2.0)) - 0.01
    
    # Determine schedule range
    if exams:
        last_exam_date_str = max(e["exam_date"] for e in exams)
        last_exam_date = datetime.fromisoformat(last_exam_date_str)
        # Schedule up to the last exam
        total_days = max(1, (last_exam_date.date() - today_local.date()).days + 1)
    else:
        total_days = 14 # Default 2 weeks if no exams (unlikely here)

    # Prepare windows for each day
    all_windows: list[tuple[str, list[WiredWindow]]] = []
    for d in range(total_days + 14): # Buffer for overflow
        day_local = today_local + timedelta(days=d)
        windows = _get_windows_for_day(user, day_local)
        if windows:
            all_windows.append((day_local.strftime("%Y-%m-%d"), windows))

    schedule: list[ScheduleBlock] = []
    task_index = 0
    
    # Track splits
    task_splits = {}

    # Exclusive zone pre-calculation
    exam_dates = []
    for e in exams:
        try:
            ed_str = e["exam_date"].replace('Z', '+00:00')
            exam_dates.append((e["id"], datetime.fromisoformat(ed_str).replace(tzinfo=None).date()))
        except:
            continue

    for day_str, windows in all_windows:
        day_limit_min = neto_study_hours * 60
        used_on_day_min = 0
        long_break_taken = False
        last_task_was_simulation = False
        
        # 1. Exclusive Focus Zone Check
        target_exam_id = None
        current_day_date = datetime.strptime(day_str, "%Y-%m-%d").date()
        
        upcoming_exams = sorted([
            (eid, edate) for eid, edate in exam_dates 
            if 0 <= (edate - current_day_date).days <= 4
        ], key=lambda x: x[1])
        
        if upcoming_exams:
            target_exam_id = upcoming_exams[0][0]

        for window in windows:
            if used_on_day_min >= day_limit_min:
                break

            window_is_peak = _is_peak_window(window.start_local, peak_productivity)
            window_remaining_min = min(window.capacity_min, day_limit_min - used_on_day_min)
            current_time = window.start_local

            while window_remaining_min >= 45:
                task = None

                if target_exam_id:
                    # Exclusive Zone: Only pick tasks for the target exam
                    candidates = [t for t in tasks if t["exam_id"] == target_exam_id and remaining_task_hours[t["id"]] > 0.01 and _dependency_satisfied(t)]
                else:
                    # Standard scan — all exams
                    candidates = [t for t in tasks if remaining_task_hours[t["id"]] > 0.01 and _dependency_satisfied(t)]

                if candidates:
                    if window_is_peak:
                        # Peak window: prefer high focus-score tasks (>= 8)
                        high_focus = [t for t in candidates if int(t.get("focus_score", 5)) >= 8]
                        task = high_focus[0] if high_focus else candidates[0]
                    else:
                        # Off-peak: prefer lower focus-score tasks (< 8), then fallback
                        low_focus = [t for t in candidates if int(t.get("focus_score", 5)) < 8]
                        task = low_focus[0] if low_focus else candidates[0]

                if not task:
                    # No tasks available for THIS DAY'S constraints.
                    # Move to the next window/day instead of breaking the entire scheduler.
                    window_remaining_min = 0  # Force exit this window
                    continue
                
                tid = task["id"]
                rem_h = remaining_task_hours[tid]
                
                take_min = min(rem_h * 60, window_remaining_min)
                
                if take_min < 45:
                    # This task is too small for the remaining window.
                    # Stop filling this window.
                    break
                
                end_time = current_time + timedelta(minutes=take_min)
                
                # Create block
                block = ScheduleBlock(
                    task_id=tid,
                    exam_id=task.get("exam_id"),
                    exam_name=exam_map.get(task.get("exam_id"), {}).get("name", "General"),
                    task_title=task["title"],
                    subject=task.get("subject"),
                    start_time=(current_time + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z'),
                    end_time=(end_time + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z'),
                    day_date=day_str,
                    block_type="study",
                    is_delayed=False
                )
                
                if tid not in task_splits:
                    task_splits[tid] = []
                task_splits[tid].append(block)
                
                remaining_task_hours[tid] -= take_min / 60
                window_remaining_min -= take_min
                used_on_day_min += take_min

                # Mark task as started (for dependency ordering)
                completed_task_ids.add(tid)

                # 2. Break Logic
                current_break = break_minutes
                is_review = "תחקיר" in task["title"] or "Review" in task["title"]
                if last_task_was_simulation and is_review:
                    current_break = 120
                elif used_on_day_min >= (day_limit_min / 2) and not long_break_taken:
                    current_break = 60
                    long_break_taken = True
                
                last_task_was_simulation = "Simulation" in task["title"] or "סימולציה" in task["title"]
                
                current_time = end_time + timedelta(minutes=current_break)
                window_remaining_min -= current_break
                
                if current_time >= window.end_local:
                    break
        
        # Padding: if the day's study quota is not filled (gap >= 45 min), add a synthetic padding block
        if used_on_day_min > 0 and (day_limit_min - used_on_day_min) >= 45:
            # Find a padding task from the tasks list if available, otherwise create a synthetic one
            padding_task = next(
                (t for t in tasks if t.get("is_padding") and remaining_task_hours.get(t["id"], 0) > 0.01),
                None
            )
            gap_min = day_limit_min - used_on_day_min
            if padding_task:
                # Use an existing padding task
                take_min = min(remaining_task_hours[padding_task["id"]] * 60, gap_min)
                if take_min >= 45:
                    pad_start = windows[-1].end_local - timedelta(hours=1) - timedelta(minutes=take_min)
                    pad_end = pad_start + timedelta(minutes=take_min)
                    schedule.append(ScheduleBlock(
                        task_id=padding_task.get("id"),
                        exam_id=padding_task.get("exam_id"),
                        exam_name=exam_map.get(padding_task.get("exam_id"), {}).get("name", "General"),
                        task_title=padding_task["title"],
                        subject=padding_task.get("subject", ""),
                        start_time=(pad_start + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                        end_time=(pad_end + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                        day_date=day_str,
                        block_type="study",
                        is_delayed=False,
                    ))
                    remaining_task_hours[padding_task["id"]] -= take_min / 60
            else:
                # Synthetic padding block (no task_id)
                take_min = min(gap_min, 60)
                if take_min >= 45 and windows:
                    last_win = windows[-1]
                    pad_end = last_win.end_local - timedelta(hours=1)
                    pad_start = pad_end - timedelta(minutes=take_min)
                    if pad_start >= last_win.start_local:
                        schedule.append(ScheduleBlock(
                            task_id=None,
                            exam_id=None,
                            exam_name="General",
                            task_title="General Review",
                            subject="Review",
                            start_time=(pad_start + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                            end_time=(pad_end + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
                            day_date=day_str,
                            block_type="study",
                            is_delayed=False,
                        ))

        # Add Hobby block at the FIXED end of day slot (reserved in _get_windows_for_day)
        if used_on_day_min > 0:
            wake_h, wake_m = map(int, user.get("wake_up_time", "08:00").split(":"))
            sleep_h, sleep_m = map(int, user.get("sleep_time", "23:00").split(":"))
            day_dt = datetime.strptime(day_str, "%Y-%m-%d")
            
            if sleep_h < wake_h:
                h_end_local = (day_dt + timedelta(days=1)).replace(hour=sleep_h, minute=sleep_m)
            else:
                h_end_local = day_dt.replace(hour=sleep_h, minute=sleep_m)
                
            h_start_local = h_end_local - timedelta(hours=1)
            
            schedule.append(ScheduleBlock(
                task_id=None, exam_id=None, exam_name="Relax",
                task_title=hobby_name, subject="Hobby",
                start_time=(h_start_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z'),
                end_time=(h_end_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z'),
                day_date=day_str, block_type="hobby"
            ))

    # Post-process splits and consolidate blocks into the main schedule
    for tid, blocks in task_splits.items():
        total_parts = len(blocks)
        for i, block in enumerate(blocks):
            if total_parts > 1:
                block.is_split = 1
                block.part_number = i + 1
                block.total_parts = total_parts
                # Update title to include part number? 
                # The plan says "Ensure UI handles part numbering", but doesn't explicitly say to change title here.
                # However, it helps for debugging. 
                # Let's keep title as is, and UI will use part_number.
            schedule.append(block)

    # Sort final schedule by time
    schedule.sort(key=lambda b: (b.day_date, b.start_time))

    return schedule

def _get_windows_for_day(user: dict, day_local: datetime) -> list[WiredWindow]:
    wake_h, wake_m = map(int, user.get("wake_up_time", "08:00").split(":"))
    sleep_h, sleep_m = map(int, user.get("sleep_time", "23:00").split(":"))
    
    # Study starts 1 hour after waking up
    start_time = day_local.replace(hour=wake_h, minute=wake_m) + timedelta(hours=1)
    
    # If sleep time is early morning (e.g., 02:00), it's the next calendar day relative to wake up
    if sleep_h < wake_h:
        end_time = (day_local + timedelta(days=1)).replace(hour=sleep_h, minute=sleep_m)
    else:
        end_time = day_local.replace(hour=sleep_h, minute=sleep_m)
    
    if start_time >= end_time:
        return []
    
    windows = [(start_time, end_time)]
    
    # Subtract fixed breaks
    try:
        fixed_breaks = json.loads(user.get("fixed_breaks", "[]"))
    except:
        fixed_breaks = []
        
    py_day = day_local.weekday()
    
    # 2. Subtract fixed breaks
    for brk in fixed_breaks:
        if py_day in brk.get("days", []):
            try:
                b_start_h, b_start_m = map(int, brk["start"].split(":"))
                b_end_h, b_end_m = map(int, brk["end"].split(":"))
                b_start = day_local.replace(hour=b_start_h, minute=b_start_m)
                b_end = day_local.replace(hour=b_end_h, minute=b_end_m)
                windows = _subtract_range(windows, b_start, b_end)
            except:
                continue

    # 3. Subtract hobby slot (1 hour before sleep)
    hobby_name = user.get("hobby_name")
    if hobby_name:
        h_end = end_time
        h_start = h_end - timedelta(hours=1)
        windows = _subtract_range(windows, h_start, h_end)

    res = [WiredWindow(s, e) for s, e in windows if (e - s).total_seconds() >= 45 * 60]
    print(f"DEBUG SCHEDULER: {day_local.strftime('%Y-%m-%d')} has {len(res)} windows: {res}")
    return res

def _subtract_range(windows: list[tuple[datetime, datetime]], s: datetime, e: datetime) -> list[tuple[datetime, datetime]]:
    new_windows = []
    for w_start, w_end in windows:
        if s < w_end and e > w_start:
            if s > w_start:
                new_windows.append((w_start, s))
            if e < w_end:
                new_windows.append((e, w_end))
        else:
            new_windows.append((w_start, w_end))
    return new_windows
