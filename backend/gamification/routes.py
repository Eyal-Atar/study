"""Gamification API routes — login-check, award-xp, reschedule-task, summary."""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from server.database import get_db
from auth.utils import get_current_user
from gamification.utils import (
    calculate_xp,
    update_user_xp,
    update_streak,
    check_and_award_badges,
    _today_in_tz,
)

router = APIRouter()


# ─── Request/Response schemas ─────────────────────────────────────────────────

class AwardXpRequest(BaseModel):
    task_id: int
    block_id: int


class RescheduleRequest(BaseModel):
    action: str  # "reschedule" | "delete" | "skip"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_morning_tasks(db, user_id: int, tz_offset: int) -> list:
    """Return tasks from yesterday (or earlier) that were not completed."""
    today = _today_in_tz(tz_offset)
    rows = db.execute(
        """SELECT t.id, t.title, t.subject, t.estimated_hours, t.day_date, t.priority
           FROM tasks t
           WHERE t.user_id = ?
             AND t.status NOT IN ('done', 'deferred')
             AND t.day_date IS NOT NULL
             AND t.day_date < ?
           ORDER BY t.day_date, t.priority DESC
           LIMIT 20""",
        (user_id, today),
    ).fetchall()
    return [dict(r) for r in rows]


def _get_xp_row(db, user_id: int) -> dict:
    row = db.execute(
        "SELECT total_xp, current_level, daily_xp, daily_xp_date, tasks_completed FROM user_xp WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        return {"total_xp": 0, "current_level": 1, "daily_xp": 0, "daily_xp_date": None, "tasks_completed": 0}
    return dict(row)


def _get_streak_row(db, user_id: int) -> dict:
    row = db.execute(
        "SELECT current_streak, longest_streak, last_login_date, streak_broken FROM user_streaks WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row is None:
        return {"current_streak": 0, "longest_streak": 0, "last_login_date": None, "streak_broken": 0}
    return dict(row)


# ─── POST /gamification/login-check ──────────────────────────────────────────

@router.post("/login-check")
def login_check(current_user: dict = Depends(get_current_user)):
    """First-of-day gate: update streak, return morning prompt data.

    Returns early with { first_login_today: False } on repeated calls the same day.
    On first call: returns streak info, morning tasks, and any newly earned badges.
    """
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0

    db = get_db()
    try:
        # update_streak handles first-login detection and streak counting
        streak_result = update_streak(db, user_id, tz_offset)

        if not streak_result["first_login_today"]:
            # Not the first login today — return minimal response
            return {"first_login_today": False}

        # First login today — gather full morning prompt data
        morning_tasks = _get_morning_tasks(db, user_id, tz_offset)

        # Fetch current XP row for badge check
        xp_row = _get_xp_row(db, user_id)

        # Check for newly earned badges after streak update
        badges_newly_earned = check_and_award_badges(db, user_id, xp_row, streak_result)

        return {
            "first_login_today": True,
            "streak": streak_result["current_streak"],
            "longest_streak": streak_result["longest_streak"],
            "streak_broken": streak_result["streak_broken"],
            "is_milestone": bool(streak_result.get("is_milestone")),
            "morning_tasks": morning_tasks,
            "badges_newly_earned": badges_newly_earned,
        }
    finally:
        db.close()


# ─── POST /gamification/award-xp ─────────────────────────────────────────────

@router.post("/award-xp")
def award_xp(body: AwardXpRequest, current_user: dict = Depends(get_current_user)):
    """Award XP for a completed schedule block.

    Idempotent: returns xp_earned=0 if the block was already awarded.
    Checks badge criteria after updating XP.
    """
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0

    db = get_db()
    try:
        # 1. Verify block exists and belongs to user
        block = db.execute(
            """SELECT sb.id, sb.task_id, sb.completed, sb.xp_awarded
               FROM schedule_blocks sb
               WHERE sb.id = ? AND sb.user_id = ?""",
            (body.block_id, user_id),
        ).fetchone()

        if not block:
            raise HTTPException(status_code=404, detail="Block not found")

        if not block["completed"]:
            raise HTTPException(status_code=400, detail="Block is not completed yet")

        # 2. Idempotency check
        if block["xp_awarded"]:
            return {
                "xp_earned": 0,
                "new_total": None,
                "new_level": None,
                "level_up": False,
                "daily_xp": None,
                "badges_earned": [],
            }

        # 3. Fetch task for XP calculation
        task = db.execute(
            "SELECT id, focus_score, estimated_hours FROM tasks WHERE id = ? AND user_id = ?",
            (body.task_id, user_id),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        focus_score = task["focus_score"] if task["focus_score"] is not None else 5
        estimated_hours = task["estimated_hours"] if task["estimated_hours"] is not None else 1.0

        xp_earned = calculate_xp(focus_score, estimated_hours)

        # 4. Mark block as XP awarded (prevents double-award)
        db.execute(
            "UPDATE schedule_blocks SET xp_awarded = 1 WHERE id = ? AND user_id = ?",
            (body.block_id, user_id),
        )
        db.commit()

        # 5. Update total XP and level
        xp_result = update_user_xp(db, user_id, xp_earned, tz_offset)

        # 6. Check badges
        streak_row = _get_streak_row(db, user_id)
        badges_earned = check_and_award_badges(db, user_id, xp_result, streak_row)

        return {
            "xp_earned": xp_earned,
            "new_total": xp_result["total_xp"],
            "new_level": xp_result["current_level"],
            "level_up": xp_result["level_up"],
            "daily_xp": xp_result["daily_xp"],
            "badges_earned": badges_earned,
        }
    finally:
        db.close()


# ─── POST /gamification/reschedule-task/{task_id} ────────────────────────────

@router.post("/reschedule-task/{task_id}")
def reschedule_task(task_id: int, body: RescheduleRequest, current_user: dict = Depends(get_current_user)):
    """Handle morning prompt actions for an unfinished task.

    action="reschedule": move day_date to today (rollover)
    action="delete": set status to 'deferred'
    action="skip": no change (acknowledged but left as-is)
    """
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    action = body.action

    if action not in ("reschedule", "delete", "skip"):
        raise HTTPException(status_code=400, detail="action must be 'reschedule', 'delete', or 'skip'")

    db = get_db()
    try:
        # Verify task belongs to user
        task = db.execute(
            "SELECT id, title, day_date, status, user_id FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, user_id),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        today = _today_in_tz(tz_offset)

        if action == "reschedule":
            # Move task to today
            db.execute(
                "UPDATE tasks SET day_date = ?, is_delayed = 1 WHERE id = ? AND user_id = ?",
                (today, task_id, user_id),
            )
            # Update schedule blocks for this task as well
            db.execute(
                """UPDATE schedule_blocks
                   SET day_date = ?, is_delayed = 1,
                       start_time = replace(start_time, substr(start_time, 1, 10), ?),
                       end_time   = replace(end_time,   substr(end_time,   1, 10), ?)
                   WHERE task_id = ? AND user_id = ?""",
                (today, today, today, task_id, user_id),
            )
            db.commit()
            return {"message": "Task rescheduled to today", "task_id": task_id, "new_date": today}

        elif action == "delete":
            db.execute(
                "UPDATE tasks SET status = 'deferred' WHERE id = ? AND user_id = ?",
                (task_id, user_id),
            )
            db.commit()
            return {"message": "Task deferred", "task_id": task_id}

        else:  # skip
            return {"message": "Task skipped (no change)", "task_id": task_id}
    finally:
        db.close()


# ─── GET /gamification/summary ───────────────────────────────────────────────

@router.get("/summary")
def get_summary(current_user: dict = Depends(get_current_user)):
    """Return full gamification state for the dashboard.

    Returns XP data, streak data, and all earned badges.
    Automatically resets daily_xp if the date has rolled over.
    """
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    today = _today_in_tz(tz_offset)

    db = get_db()
    try:
        # XP data
        xp_row = db.execute(
            "SELECT total_xp, current_level, daily_xp, daily_xp_date, tasks_completed FROM user_xp WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if xp_row is None:
            xp_data = {"total_xp": 0, "current_level": 1, "daily_xp": 0, "daily_xp_date": today, "tasks_completed": 0}
        else:
            xp_data = dict(xp_row)
            # Reset daily_xp if date has changed
            if xp_data.get("daily_xp_date") != today:
                db.execute(
                    "UPDATE user_xp SET daily_xp = 0, daily_xp_date = ? WHERE user_id = ?",
                    (today, user_id),
                )
                db.commit()
                xp_data["daily_xp"] = 0
                xp_data["daily_xp_date"] = today

        # Streak data
        streak_row = db.execute(
            "SELECT current_streak, longest_streak, last_login_date, streak_broken FROM user_streaks WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if streak_row is None:
            streak_data = {"current_streak": 0, "longest_streak": 0, "last_login_date": None, "streak_broken": False}
        else:
            streak_data = dict(streak_row)
            streak_data["streak_broken"] = bool(streak_data["streak_broken"])

        # All earned badges
        badge_rows = db.execute(
            "SELECT badge_key, earned_at FROM user_badges WHERE user_id = ? ORDER BY earned_at DESC",
            (user_id,),
        ).fetchall()
        badges = [dict(r) for r in badge_rows]

        return {
            "xp": xp_data,
            "streak": streak_data,
            "badges": badges,
        }
    finally:
        db.close()
