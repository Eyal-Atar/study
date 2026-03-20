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
    start_buffer_hours: float = 0
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
    peak_productivity = user.get("peak_productivity", "Morning") or "Morning"

    try:
        sleep_h, sleep_m = map(int, user.get("sleep_time", "23:00").split(":"))
    except (ValueError, TypeError):
        sleep_h, sleep_m = 23, 0
    try:
        wake_h_default, wake_m_default = map(int, user.get("wake_up_time", "08:00").split(":"))
    except (ValueError, TypeError):
        wake_h_default, wake_m_default = 8, 0
    STUDY_CUTOFF_HOUR = (sleep_h - 1) % 24
    MIN_BLOCK_MIN = 30
    TASK_BUFFER_MIN = 10

    # 'Today' in user's local time
    now_utc = datetime.now(timezone.utc)
    local_now = now_utc - timedelta(minutes=tz_offset)
    
    # Calculate natural day start (wake-up time + 1 hour)
    wake_h, wake_m = map(int, user.get("wake_up_time", "08:00").split(":"))
    day_start_natural = local_now.replace(hour=wake_h, minute=wake_m, second=0, microsecond=0) + timedelta(hours=1)
    
    # today_start_buffer should be the LATER of natural day start OR (local_now + buffer)
    # This prevents the "moving target" drift when refreshing during the day.
    today_start_buffer = max(day_start_natural, local_now + timedelta(hours=start_buffer_hours))
    today_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    # Exam lookup
    exam_map = {e["id"]: e for e in exams}
    
    # Task state
    remaining_task_hours = {t["id"]: float(t.get("estimated_hours", 2.0)) for t in tasks if t.get("id") is not None}

    # Determine schedule range
    if exams:
        last_exam_date_str = max(e["exam_date"] for e in exams)
        last_exam_date_str = last_exam_date_str.replace('Z', '+00:00')
        last_exam_date = datetime.fromisoformat(last_exam_date_str)
        total_days = max(1, (last_exam_date.date() - today_local.date()).days + 1)
    else:
        total_days = 14

    range_limit = total_days if exams else total_days + 14
    
    all_windows: list[tuple[str, list[WiredWindow]]] = []
    for d in range(range_limit):
        day_local = today_local + timedelta(days=d)
        windows = _get_windows_for_day(user, day_local, MIN_BLOCK_MIN)
        if windows:
            all_windows.append((day_local.strftime("%Y-%m-%d"), windows))

    schedule: list[ScheduleBlock] = []
    task_splits = {}

    # Pre-calculation
    exam_dates_only = set()
    exam_date_lookup = {}
    for e in exams:
        try:
            ed_str = e["exam_date"].replace('Z', '+00:00')
            dt = datetime.fromisoformat(ed_str).replace(tzinfo=None).date()
            exam_dates_only.add(dt)
            exam_date_lookup[e["id"]] = dt
        except:
            continue

    for day_str, windows in all_windows:
        day_limit_min = neto_study_hours * 60
        used_on_day_min = 0
        long_break_taken = False
        last_task_was_simulation = False
        last_block_end = None

        # Reconstruct day_local for this scheduling day (the loop variable from
        # the all_windows construction above is stale by now).
        day_local = today_local + timedelta(days=(datetime.strptime(day_str, "%Y-%m-%d").date() - today_local.date()).days)
        current_day_date = day_local.date()

        if current_day_date in exam_dates_only:
            continue

        is_day_before_exam = (current_day_date + timedelta(days=1)) in exam_dates_only

        # Define once per day instead of inside while loop
        def _is_task_valid(t: dict, _day=current_day_date) -> bool:
            eid = t.get("exam_id")
            if not eid or eid not in exam_date_lookup:
                return True
            return _day < exam_date_lookup[eid]

        skipped_this_day = set()
        cutoff_dt = None  # initialized here so padding/motivation can use it safely

        for window in windows:
            if used_on_day_min >= day_limit_min:
                break

            window_is_peak = _is_peak_window(window.start_local, peak_productivity)
            window_remaining_min = min(window.capacity_min, day_limit_min - used_on_day_min)
            current_time = window.start_local

            if is_day_before_exam:
                if sleep_h < wake_h_default:
                    sleep_dt = (day_local + timedelta(days=1)).replace(hour=sleep_h, minute=sleep_m)
                else:
                    sleep_dt = day_local.replace(hour=sleep_h, minute=sleep_m)

                cutoff_dt = sleep_dt - timedelta(hours=5)
                
                if window.start_local >= cutoff_dt:
                    window_remaining_min = 0
                elif window.end_local > cutoff_dt:
                    window_remaining_min = min(window_remaining_min, (cutoff_dt - window.start_local).total_seconds() / 60)
            
            if day_str == today_local.strftime("%Y-%m-%d"):
                if window.end_local <= today_start_buffer:
                    window_remaining_min = 0
                elif window.start_local < today_start_buffer:
                    remaining_in_window = (window.end_local - today_start_buffer).total_seconds() / 60
                    window_remaining_min = min(remaining_in_window, day_limit_min - used_on_day_min)
                    current_time = today_start_buffer

            while window_remaining_min >= 1.0: # Minimum window to try scheduling
                if current_time.hour >= STUDY_CUTOFF_HOUR and current_time.hour > window.start_local.hour:
                    break

                overdue_tasks = [
                    t for t in tasks
                    if t.get("day_date") and t.get("day_date") < day_str
                    and remaining_task_hours.get(t["id"], 0) > 0.01
                    and _is_task_valid(t)
                ]

                assigned_to_today = [
                    t for t in tasks 
                    if t.get("day_date") == day_str 
                    and remaining_task_hours.get(t["id"], 0) > 0.01 
                    and _is_task_valid(t)
                ]

                candidates = [t for t in (overdue_tasks + assigned_to_today) if t["id"] not in skipped_this_day]

                # If no overdue/today tasks, pull forward future tasks whose exam
                # hasn't happened yet.  This fills empty gap days (e.g. between
                # two exams) instead of leaving them blank.
                if not candidates:
                    future_tasks = [
                        t for t in tasks
                        if t.get("day_date") and t.get("day_date") > day_str
                        and remaining_task_hours.get(t["id"], 0) > 0.01
                        and _is_task_valid(t)
                        and t["id"] not in skipped_this_day
                    ]
                    # Sort by day_date (earliest first) so closer deadlines fill first
                    future_tasks.sort(key=lambda t: t.get("day_date", ""))
                    candidates = future_tasks

                if not candidates:
                    window_remaining_min = 0
                    continue

                def _safe_focus(t):
                    try:
                        return int(t.get("focus_score", 5))
                    except (ValueError, TypeError):
                        return 5

                if window_is_peak:
                    high_focus = [t for t in candidates if _safe_focus(t) >= 8]
                    task = high_focus[0] if high_focus else candidates[0]
                else:
                    low_focus = [t for t in candidates if _safe_focus(t) < 8]
                    task = low_focus[0] if low_focus else candidates[0]

                tid = task["id"]
                rem_h = remaining_task_hours[tid]
                is_simulation = any(keyword in task["title"] for keyword in ["סימולציה", "Simulation"])
                
                if is_simulation:
                    take_min = rem_h * 60
                    if take_min > window_remaining_min:
                        skipped_this_day.add(tid)
                        continue
                else:
                    take_min = min(rem_h * 60, window_remaining_min)
                
                # Fragmentation logic:
                # If task is large but window is small, break and leave gap for padding.
                # If task is small (fragment), schedule it anyway as long as it fits.
                if take_min < MIN_BLOCK_MIN and (rem_h * 60) > (take_min + 0.01):
                    window_remaining_min = 0 # Exit while loop for this window
                    break
                
                if take_min < 1.0:
                    skipped_this_day.add(tid)
                    continue
                
                end_time = current_time + timedelta(minutes=take_min)
                
                block = ScheduleBlock(
                    task_id=tid,
                    exam_id=task.get("exam_id"),
                    exam_name=exam_map.get(task.get("exam_id"), {}).get("name", "General"),
                    task_title=task["title"],
                    subject=task.get("subject"),
                    start_time=(current_time + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace('+00:00', 'Z'),
                    end_time=(end_time + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace('+00:00', 'Z'),
                    day_date=day_str,
                    block_type="study",
                    is_delayed=False
                )
                
                if take_min >= (rem_h * 60) - 0.01 and tid not in task_splits:
                    schedule.append(block)
                else:
                    if tid not in task_splits:
                        task_splits[tid] = []
                    task_splits[tid].append(block)
                
                last_block_end = end_time
                remaining_task_hours[tid] -= take_min / 60
                window_remaining_min -= take_min
                used_on_day_min += take_min

                current_break = TASK_BUFFER_MIN
                is_review = "תחקיר" in task["title"] or "Review" in task["title"]
                if last_task_was_simulation and is_review:
                    current_break = 120
                elif used_on_day_min >= (day_limit_min / 2) and not long_break_taken:
                    current_break = 60
                    long_break_taken = True
                
                last_task_was_simulation = is_simulation
                current_time = end_time + timedelta(minutes=current_break)
                window_remaining_min -= current_break
                
                if current_time >= window.end_local:
                    break
        
        # Padding
        if used_on_day_min > 0 and (day_limit_min - used_on_day_min) >= MIN_BLOCK_MIN:
            upcoming_exams = sorted([(eid, edate) for eid, edate in exam_date_lookup.items() if edate >= current_day_date], key=lambda x: x[1])
            target_exam_id = upcoming_exams[0][0] if upcoming_exams else None

            padding_task = next((t for t in tasks if t.get("is_padding") and t.get("day_date") == day_str and remaining_task_hours.get(t["id"], 0) > 0.01), None)
            gap_min = day_limit_min - used_on_day_min
            
            if padding_task:
                take_min = min(remaining_task_hours[padding_task["id"]] * 60, gap_min)
                if take_min >= MIN_BLOCK_MIN:
                    pad_end = windows[-1].end_local - timedelta(hours=1)
                    if is_day_before_exam:
                        pad_end = min(pad_end, cutoff_dt - timedelta(minutes=45)) # Leave room for Motivation
                    pad_start = pad_end - timedelta(minutes=take_min)
                    
                    tid = padding_task["id"]
                    block = ScheduleBlock(
                        task_id=tid, exam_id=padding_task.get("exam_id"),
                        exam_name=exam_map.get(padding_task.get("exam_id"), {}).get("name", "General"),
                        task_title=padding_task["title"], subject=padding_task.get("subject", ""),
                        start_time=(pad_start + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace("+00:00", "Z"),
                        end_time=(pad_end + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace("+00:00", "Z"),
                        day_date=day_str, block_type="study"
                    )
                    if tid not in task_splits: task_splits[tid] = []
                    task_splits[tid].append(block)
                    remaining_task_hours[padding_task["id"]] -= take_min / 60
                    if last_block_end is None or pad_end > last_block_end:
                        last_block_end = pad_end
            elif windows and last_block_end is not None:
                last_win = windows[-1]
                pad_exam_id = target_exam_id
                pad_exam = exam_map.get(pad_exam_id, {}) if pad_exam_id else (exams[0] if exams else {})
                pad_exam_id = pad_exam.get("id")
                pad_exam_name = pad_exam.get("name", "General")

                fill_gap_min = gap_min
                pad_start = last_block_end + timedelta(minutes=TASK_BUFFER_MIN)
                while fill_gap_min >= MIN_BLOCK_MIN:
                    if pad_start >= last_win.end_local: break
                    if is_day_before_exam and pad_start >= cutoff_dt - timedelta(minutes=30): break
                    
                    max_avail = (last_win.end_local - pad_start).total_seconds() / 60
                    if is_day_before_exam:
                        max_avail = min(max_avail, (cutoff_dt - timedelta(minutes=35) - pad_start).total_seconds() / 60)
                    
                    block_min = min(fill_gap_min, 120, max_avail)
                    if block_min < MIN_BLOCK_MIN: break
                    pad_end = pad_start + timedelta(minutes=block_min)
                    schedule.append(ScheduleBlock(
                        task_id=None, exam_id=pad_exam_id, exam_name=pad_exam_name,
                        task_title=f"חזרה מרווחת (Spaced Repetition): {pad_exam_name}",
                        subject="Review",
                        start_time=(pad_start + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace("+00:00", "Z"),
                        end_time=(pad_end + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace("+00:00", "Z"),
                        day_date=day_str, block_type="study"
                    ))
                    fill_gap_min -= block_min
                    last_block_end = pad_end
                    pad_start = pad_end + timedelta(minutes=TASK_BUFFER_MIN)

        # End of day sequence: Motivation -> Hobby
        mot_start = None
        mot_end = None
        if is_day_before_exam:
            # Use last_block_end if available, otherwise current_time or today_start_buffer
            mot_start = (last_block_end + timedelta(minutes=TASK_BUFFER_MIN)) if last_block_end else current_time
            
            # Final safety check against cutoff
            if cutoff_dt and mot_start > cutoff_dt - timedelta(minutes=30):
                mot_start = cutoff_dt - timedelta(minutes=30)
            
            mot_end = mot_start + timedelta(minutes=30)
            schedule.append(ScheduleBlock(
                task_id=None, exam_id=None, exam_name="Ready",
                task_title="Finish Line: You are ready! 🏁", subject="Motivation",
                start_time=(mot_start + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace('+00:00', 'Z'),
                end_time=(mot_end + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace('+00:00', 'Z'),
                day_date=day_str, block_type="study"
            ))

        # Hobby placement: 1 hour before sleep, but MUST be after Motivation or last study block
        if sleep_h < wake_h_default:
            h_end_local = (day_local + timedelta(days=1)).replace(hour=sleep_h, minute=sleep_m)
        else:
            h_end_local = day_local.replace(hour=sleep_h, minute=sleep_m)
        
        h_start_local = h_end_local - timedelta(hours=1)
        
        # Guard against hobby overlapping with Motivation or last study block
        limit_start = mot_end if mot_end else last_block_end
        if limit_start and h_start_local < limit_start + timedelta(minutes=TASK_BUFFER_MIN):
            h_start_local = limit_start + timedelta(minutes=TASK_BUFFER_MIN)
            h_end_local = h_start_local + timedelta(hours=1)

        schedule.append(ScheduleBlock(
            task_id=None, exam_id=None, exam_name="Relax",
            task_title=hobby_name, subject="Hobby",
            start_time=(h_start_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace('+00:00', 'Z'),
            end_time=(h_end_local + timedelta(minutes=tz_offset)).replace(tzinfo=timezone.utc, microsecond=0).isoformat().replace('+00:00', 'Z'),
            day_date=day_str, block_type="hobby"
        ))

    # Resolve split tasks (ensure parts are correctly labeled and avoid duplication)
    final_schedule = []
    
    # First, add all blocks that were NOT split
    for block in schedule:
        if block.task_id not in task_splits:
            final_schedule.append(block)
            
    # Then, add all parts of split tasks
    for tid, blocks in task_splits.items():
        total_parts = len(blocks)
        for i, block in enumerate(blocks):
            if total_parts > 1:
                block.is_split = 1
                block.part_number = i + 1
                block.total_parts = total_parts
            final_schedule.append(block)

    final_schedule.sort(key=lambda b: (b.day_date, b.start_time))
    return final_schedule

def _get_windows_for_day(user: dict, day_local: datetime, min_block_min: int = 45) -> list[WiredWindow]:
    try:
        wake_h, wake_m = map(int, user.get("wake_up_time", "08:00").split(":"))
    except (ValueError, TypeError):
        wake_h, wake_m = 8, 0
    try:
        sleep_h, sleep_m = map(int, user.get("sleep_time", "23:00").split(":"))
    except (ValueError, TypeError):
        sleep_h, sleep_m = 23, 0
        
    start_time_natural = day_local.replace(hour=wake_h, minute=wake_m) + timedelta(hours=1)
    if sleep_h < wake_h:
        end_time_natural = (day_local + timedelta(days=1)).replace(hour=sleep_h, minute=sleep_m)
    else:
        end_time_natural = day_local.replace(hour=sleep_h, minute=sleep_m)
    
    if start_time_natural >= end_time_natural: return []

    # Intersection with study_hours_preference
    try:
        pref_str = user.get("study_hours_preference", '["morning", "afternoon"]')
        preferences = [p.lower() for p in json.loads(pref_str)]
    except:
        preferences = ["morning", "afternoon"]
    
    if not preferences:
        preferences = ["morning", "afternoon", "night"]

    PREF_DEFINITIONS = {
        "morning": (8, 14),
        "afternoon": (14, 20),
        "night": (20, 2), # wraps to next day
    }

    preference_windows = []
    for pref in preferences:
        if pref not in PREF_DEFINITIONS: continue
        ph_start, ph_end = PREF_DEFINITIONS[pref]
        
        p_start = day_local.replace(hour=ph_start, minute=0)
        if ph_end < ph_start:
            p_end = (day_local + timedelta(days=1)).replace(hour=ph_end, minute=0)
        else:
            p_end = day_local.replace(hour=ph_end, minute=0)
            
        # Intersect [p_start, p_end] with [start_time_natural, end_time_natural]
        intersect_start = max(p_start, start_time_natural)
        intersect_end = min(p_end, end_time_natural)
        
        if intersect_start < intersect_end:
            preference_windows.append((intersect_start, intersect_end))

    if not preference_windows:
        # Fallback if preferences don't overlap with natural day at all
        windows = [(start_time_natural, end_time_natural)]
    else:
        # Merge overlapping preference windows and sort them
        preference_windows.sort()
        merged = []
        if preference_windows:
            curr_s, curr_e = preference_windows[0]
            for i in range(1, len(preference_windows)):
                next_s, next_e = preference_windows[i]
                if next_s <= curr_e:
                    curr_e = max(curr_e, next_e)
                else:
                    merged.append((curr_s, curr_e))
                    curr_s, curr_e = next_s, next_e
            merged.append((curr_s, curr_e))
        windows = merged

    # Subtract fixed breaks
    try:
        fixed_breaks = json.loads(user.get("fixed_breaks", "[]"))
    except:
        fixed_breaks = []
    py_day = day_local.weekday()
    for brk in fixed_breaks:
        if py_day in brk.get("days", []):
            try:
                b_start = day_local.replace(hour=int(brk["start"].split(":")[0]), minute=int(brk["start"].split(":")[1]))
                b_end = day_local.replace(hour=int(brk["end"].split(":")[0]), minute=int(brk["end"].split(":")[1]))
                if b_end <= b_start:
                    b_end = b_end + timedelta(days=1)
                windows = _subtract_range(windows, b_start, b_end)
            except: continue
    
    # Subtract hobby (last 1 hour before sleep)
    hobby_name = user.get("hobby_name")
    if hobby_name:
        h_end = end_time_natural
        h_start = h_end - timedelta(hours=1)
        windows = _subtract_range(windows, h_start, h_end)
        
    res = [WiredWindow(s, e) for s, e in windows if (e - s).total_seconds() >= min_block_min * 60]
    return res

def _subtract_range(windows: list[tuple[datetime, datetime]], s: datetime, e: datetime) -> list[tuple[datetime, datetime]]:
    new_windows = []
    for w_start, w_end in windows:
        if s < w_end and e > w_start:
            if s > w_start: new_windows.append((w_start, s))
            if e < w_end: new_windows.append((e, w_end))
        else: new_windows.append((w_start, w_end))
    return new_windows
