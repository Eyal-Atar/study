"""Gamification utility functions — XP calculation, streak updates, badge checking."""

import math
from datetime import datetime, timezone, timedelta
from typing import Any


def _today_in_tz(tz_offset: int) -> str:
    """Return today's date string YYYY-MM-DD in user's local timezone.
    
    tz_offset: Difference in minutes between UTC and local time (JS getTimezoneOffset).
    E.g., -120 for UTC+2.
    """
    utc_now = datetime.now(timezone.utc)
    # JS getTimezoneOffset() is (UTC - Local) in minutes.
    # So Local = UTC - Offset.
    local_dt = utc_now - timedelta(minutes=tz_offset)
    return local_dt.strftime("%Y-%m-%d")


def calculate_xp(focus_score: int, estimated_hours: float) -> int:
    """Calculate XP earned for completing a task.

    Formula: round(focus_score * estimated_hours * 10)
    focus_score range: 1-10
    Returns integer XP value.
    """
    return round(focus_score * estimated_hours * 10)


def update_user_xp(db, user_id: int, xp_earned: int, tz_offset: int = 0) -> dict:
    """Add xp_earned to user's XP totals and recalculate level.

    Creates the user_xp row if it does not exist yet.
    Resets daily_xp when the date rolls over.
    Increments tasks_completed by 1 on every call.
    Returns dict with total_xp, current_level, daily_xp, level_up flag, tasks_completed.
    """
    today = _today_in_tz(tz_offset)

    row = db.execute(
        "SELECT id, total_xp, current_level, highest_level_reached, daily_xp, daily_xp_date, tasks_completed FROM user_xp WHERE user_id = ?",
        (user_id,),
    ).fetchone()

    if row is None:
        db.execute(
            "INSERT INTO user_xp (user_id, total_xp, current_level, highest_level_reached, daily_xp, daily_xp_date, tasks_completed) VALUES (?, 0, 1, 1, 0, ?, 0)",
            (user_id, today),
        )
        row = db.execute(
            "SELECT id, total_xp, current_level, highest_level_reached, daily_xp, daily_xp_date, tasks_completed FROM user_xp WHERE user_id = ?",
            (user_id,),
        ).fetchone()

    prev_total_xp = row["total_xp"]
    prev_level = row["current_level"]
    highest_level = row["highest_level_reached"] or 1

    # Reset daily XP when date changes
    daily_xp = row["daily_xp"] if row["daily_xp_date"] == today else 0

    # Increment tasks_completed counter
    tasks_completed = (row["tasks_completed"] or 0) + 1

    new_total_xp = prev_total_xp + xp_earned
    new_daily_xp = daily_xp + xp_earned

    # Level formula: level = min(50, floor(total_xp / 1000) + 1)
    new_level = min(50, math.floor(new_total_xp / 1000) + 1)
    new_highest_level = max(highest_level, new_level)

    db.execute(
        """UPDATE user_xp
           SET total_xp = ?, current_level = ?, highest_level_reached = ?, daily_xp = ?, daily_xp_date = ?, tasks_completed = ?
           WHERE user_id = ?""",
        (new_total_xp, new_level, new_highest_level, new_daily_xp, today, tasks_completed, user_id),
    )

    return {
        "total_xp": new_total_xp,
        "current_level": new_level,
        "highest_level_reached": new_highest_level,
        "daily_xp": new_daily_xp,
        "level_up": new_level > highest_level, # ONLY level_up if we beat the all-time high
        "tasks_completed": tasks_completed,
    }


def revoke_user_xp(db, user_id: int, xp_to_remove: int, tz_offset: int = 0) -> dict:
    """Subtract xp_to_remove from user's XP totals and decrement tasks_completed.
    Used when a user unchecks a task that was previously awarded XP.
    """
    today = _today_in_tz(tz_offset)

    row = db.execute(
        "SELECT total_xp, current_level, highest_level_reached, daily_xp, daily_xp_date, tasks_completed FROM user_xp WHERE user_id = ?",
        (user_id,),
    ).fetchone()

    if row is None:
        return {"total_xp": 0, "current_level": 1, "highest_level_reached": 1, "daily_xp": 0, "tasks_completed": 0}

    # Ensure we don't go below zero
    new_total_xp = max(0, row["total_xp"] - xp_to_remove)
    new_tasks_completed = max(0, (row["tasks_completed"] or 0) - 1)
    
    # Only subtract from daily if the award was from today
    new_daily_xp = row["daily_xp"]
    if row["daily_xp_date"] == today:
        new_daily_xp = max(0, row["daily_xp"] - xp_to_remove)

    # Recalculate level (but DON'T lower highest_level_reached)
    new_level = min(50, math.floor(new_total_xp / 1000) + 1)
    highest_level = row["highest_level_reached"] or 1

    db.execute(
        """UPDATE user_xp
           SET total_xp = ?, current_level = ?, daily_xp = ?, daily_xp_date = ?, tasks_completed = ?
           WHERE user_id = ?""",
        (new_total_xp, new_level, new_daily_xp, today, new_tasks_completed, user_id),
    )

    return {
        "total_xp": new_total_xp,
        "current_level": new_level,
        "highest_level_reached": highest_level,
        "daily_xp": new_daily_xp,
        "tasks_completed": new_tasks_completed,
    }


def update_streak(db, user_id: int, tz_offset: int = 0) -> dict:
    """Update login streak for the user and return streak state.

    Creates the user_streaks row if it does not exist yet.
    Returns dict with current_streak, longest_streak, last_login_date,
    streak_broken, first_login_today fields.
    """
    today = _today_in_tz(tz_offset)

    row = db.execute(
        "SELECT id, current_streak, longest_streak, last_login_date, streak_broken FROM user_streaks WHERE user_id = ?",
        (user_id,),
    ).fetchone()

    if row is None:
        db.execute(
            "INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_login_date, streak_broken) VALUES (?, 1, 1, ?, 0)",
            (user_id, today),
        )
        db.commit()
        return {
            "current_streak": 1,
            "longest_streak": 1,
            "last_login_date": today,
            "streak_broken": False,
            "first_login_today": True,
        }

    last_date = row["last_login_date"]
    current_streak = row["current_streak"]
    longest_streak = row["longest_streak"]

    # Already logged in today — no change
    if last_date == today:
        return {
            "current_streak": current_streak,
            "longest_streak": longest_streak,
            "last_login_date": last_date,
            "streak_broken": bool(row["streak_broken"]),
            "first_login_today": False,
        }

    # Determine if yesterday or older
    if last_date is not None:
        try:
            last_dt = datetime.strptime(last_date, "%Y-%m-%d")
            today_dt = datetime.strptime(today, "%Y-%m-%d")
            delta_days = (today_dt - last_dt).days
        except ValueError:
            delta_days = 999  # Treat malformed date as a break
    else:
        delta_days = 1  # New row, count as consecutive

    streak_broken = False
    if delta_days == 1:
        # Consecutive day — extend streak
        current_streak += 1
    else:
        # Gap detected — streak broken
        streak_broken = True
        current_streak = 1

    if current_streak > longest_streak:
        longest_streak = current_streak

    # Milestone detection
    milestones = {7, 10, 14, 30, 100}
    is_milestone = current_streak in milestones

    # streak_broken flag in DB: 1 if broken since last splash (cleared by splash endpoint)
    new_streak_broken_flag = 1 if streak_broken else 0

    db.execute(
        """UPDATE user_streaks
           SET current_streak = ?, longest_streak = ?, last_login_date = ?, streak_broken = ?
           WHERE user_id = ?""",
        (current_streak, longest_streak, today, new_streak_broken_flag, user_id),
    )

    return {
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "last_login_date": today,
        "streak_broken": streak_broken,
        "first_login_today": True,
        "is_milestone": is_milestone,
    }


# Badge criteria: (badge_key, check_fn(user_xp_row, streak_row))
_BADGE_CRITERIA = [
    # Streak milestones
    ("iron_will_7",      lambda xp, s: s["current_streak"] >= 7),
    ("iron_will_10",     lambda xp, s: s["current_streak"] >= 10),
    ("iron_will_14",     lambda xp, s: s["current_streak"] >= 14),
    ("iron_will_30",     lambda xp, s: s["current_streak"] >= 30),
    ("iron_will_100",    lambda xp, s: s["current_streak"] >= 100),
    # Level milestones
    ("knowledge_seeker_5",   lambda xp, s: xp["current_level"] >= 5),
    ("knowledge_seeker_10",  lambda xp, s: xp["current_level"] >= 10),
    ("knowledge_seeker_20",  lambda xp, s: xp["current_level"] >= 20),
    ("knowledge_seeker_25",  lambda xp, s: xp["current_level"] >= 25),
    ("knowledge_seeker_50",  lambda xp, s: xp["current_level"] >= 50),
    ("knowledge_seeker_100", lambda xp, s: xp["current_level"] >= 50),
    # XP milestones
    ("xp_1000",  lambda xp, s: xp["total_xp"] >= 1000),
    ("xp_5000",  lambda xp, s: xp["total_xp"] >= 5000),
    ("xp_10000", lambda xp, s: xp["total_xp"] >= 10000),
    # Task milestones
    ("task_master_10",  lambda xp, s: (xp.get("tasks_completed") or 0) >= 10),
    ("task_master_20",  lambda xp, s: (xp.get("tasks_completed") or 0) >= 20),
    ("task_master_50",  lambda xp, s: (xp.get("tasks_completed") or 0) >= 50),
    ("task_master_100", lambda xp, s: (xp.get("tasks_completed") or 0) >= 100),
    # First-time achievement badges (Phase 19.1-03)
    # Fires on first ever task completed (tasks_completed key present from 19.1-03)
    ("first_task",         lambda xp, s: (xp.get("tasks_completed") or 0) >= 1),
    # Fires on first ever login: current_streak == 1 and longest_streak == 1 proxy
    # (longest_streak == 1 is only True on the first ever login day)
    ("first_login",        lambda xp, s: s["current_streak"] >= 1 and s["longest_streak"] == 1),
    # Fires when user reaches a 7-day streak (achievement moment distinct from iron_will_7 milestone)
    ("week_streak",        lambda xp, s: s["current_streak"] >= 7),
    # Fires when streak is broken (streak_broken flag is True in streak_row)
    ("streak_broken_once", lambda xp, s: bool(s.get("streak_broken", False))),
]


def check_and_award_badges(db, user_id: int, user_xp_row: dict, streak_row: dict) -> list:
    """Check badge criteria and award any newly earned badges.

    user_xp_row: dict with total_xp, current_level, daily_xp
    streak_row: dict with current_streak, longest_streak

    Returns list of newly earned badge_keys.
    """
    # Fetch already-earned badge keys
    existing = {
        row["badge_key"]
        for row in db.execute(
            "SELECT badge_key FROM user_badges WHERE user_id = ?", (user_id,)
        ).fetchall()
    }

    newly_earned = []
    for badge_key, criterion in _BADGE_CRITERIA:
        if badge_key in existing:
            continue
        try:
            if criterion(user_xp_row, streak_row):
                db.execute(
                    "INSERT OR IGNORE INTO user_badges (user_id, badge_key) VALUES (?, ?)",
                    (user_id, badge_key),
                )
                newly_earned.append(badge_key)
        except Exception:
            # Never let a badge check crash the caller
            pass

    return newly_earned


def block_duration_hours(block_row: Any) -> float:
    """Compute a schedule block's duration in hours from its start/end times."""
    try:
        s = block_row["start_time"].replace("Z", "+00:00").replace(" ", "T")
        e = block_row["end_time"].replace("Z", "+00:00").replace(" ", "T")
        start_dt = datetime.fromisoformat(s)
        end_dt = datetime.fromisoformat(e)
        hours = (end_dt - start_dt).total_seconds() / 3600
        return max(hours, 0.25)  # floor at 15 min
    except Exception:
        return 1.0


def xp_for_block(db, block_row: Any, user_id: int) -> int:
    """Calculate XP for a single block, using block duration (not full task hours).
    Falls back to defaults for standalone blocks (no task_id).
    """
    task_id = block_row["task_id"]
    focus_score = 5  # default
    if task_id:
        task = db.execute(
            "SELECT focus_score FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, user_id),
        ).fetchone()
        if task and task["focus_score"] is not None:
            focus_score = task["focus_score"]

    hours = block_duration_hours(block_row)
    return calculate_xp(focus_score, hours)
