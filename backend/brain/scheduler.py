"""
Multi-Exam Study Scheduler with Deterministic Greedy-Fill.
Decouples task prioritization (AI) from time allocation (Python).
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from brain.schemas import ScheduleBlock

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
    tz_offset = user.get("timezone_offset", 0) or 0
    hobby_name = user.get("hobby_name") or "Hobby"
    
    # 'Today' in user's local time
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc - timedelta(minutes=tz_offset)
    today_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Exam lookup
    exam_map = {e["id"]: e for e in exams}
    
    # Task state
    remaining_task_hours = {t["id"]: float(t.get("estimated_hours", 2.0)) for t in tasks}
    
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

    print(f"DEBUG SCHEDULER: Generated {len(all_windows)} windowed days. Task count: {len(tasks)}")
    
    schedule: list[ScheduleBlock] = []
    task_index = 0
    
    # Track splits
    # task_id -> {part_count: int, blocks: list[ScheduleBlock]}
    task_splits = {}

    for day_str, windows in all_windows:
        day_limit_min = neto_study_hours * 60
        used_on_day_min = 0
        
        for window in windows:
            if used_on_day_min >= day_limit_min:
                break
            
            window_remaining_min = min(window.capacity_min, day_limit_min - used_on_day_min)
            current_time = window.start_local
            
            # Use task_index to iterate through the prioritized queue
            while window_remaining_min > 1 and task_index < len(tasks):
                task = tasks[task_index]
                tid = task["id"]
                rem_h = remaining_task_hours[tid]
                
                if rem_h <= 0:
                    task_index += 1
                    continue
                
                # How much can we fit in this window?
                take_min = min(rem_h * 60, window_remaining_min)
                if take_min < 1:
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
                print(f"DEBUG SCHEDULER: Created block for {block.task_title} on {day_str}")
                
                if tid not in task_splits:
                    task_splits[tid] = []
                task_splits[tid].append(block)
                
                # Update remaining
                remaining_task_hours[tid] -= take_min / 60
                window_remaining_min -= take_min
                used_on_day_min += take_min
                current_time = end_time
                
                if remaining_task_hours[tid] <= 0.01: # handle float precision
                    task_index += 1
        
        # Add Hobby block at the end of the day if study happened
        if used_on_day_min > 0:
            # Place hobby after the last study block of the day
            day_study_blocks = [b for b in schedule if b.day_date == day_str and b.block_type == "study"]
            # Also check task_splits which haven't been added to schedule yet
            for tid in task_splits:
                for b in task_splits[tid]:
                    if b.day_date == day_str and b.block_type == "study":
                        day_study_blocks.append(b)
            
            if day_study_blocks:
                last_block = sorted(day_study_blocks, key=lambda x: x.start_time)[-1]
                last_study_end = datetime.fromisoformat(last_block.end_time.replace('Z', '+00:00')) - timedelta(minutes=tz_offset)
                
                h_start = last_study_end
                h_end = h_start + timedelta(hours=1)
                schedule.append(ScheduleBlock(
                    task_id=None, exam_id=None, exam_name="Relax",
                    task_title=hobby_name, subject="Hobby",
                    start_time=(h_start + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z'),
                    end_time=(h_end + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc).isoformat().replace('+00:00', 'Z'),
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
    
    start_time = day_local.replace(hour=wake_h, minute=wake_m)
    
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

    res = [WiredWindow(s, e) for s, e in windows if (e - s).total_seconds() > 0]
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
