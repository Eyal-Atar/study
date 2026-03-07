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
from brain.routes import internal_regenerate_schedule

router = APIRouter()


# ─── Request/Response schemas ─────────────────────────────────────────────────

class AwardXpRequest(BaseModel):
    task_id: int
    block_id: int


class RescheduleRequest(BaseModel):
    action: str  # "reschedule" | "delete" | "skip"
    force_tomorrow: bool = False


class BatchRescheduleRequest(BaseModel):
    task_ids: list[int]
    action: str  # "reschedule" | "delete"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_morning_tasks(db, user_id: int, tz_offset: int) -> list:
    """Return tasks from yesterday (or earlier) that were not completed."""
    today = _today_in_tz(tz_offset)
    rows = db.execute(
        """SELECT t.id, t.title, t.subject, t.estimated_hours, t.day_date, t.priority, t.exam_id
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
    """First-of-day gate: update streak, return morning prompt data."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0

    db = get_db()
    try:
        streak_result = update_streak(db, user_id, tz_offset)

        if not streak_result["first_login_today"]:
            return {"first_login_today": False}

        morning_tasks = _get_morning_tasks(db, user_id, tz_offset)
        yesterday = (datetime.now(timezone.utc) - timedelta(minutes=tz_offset) - timedelta(days=1)).strftime("%Y-%m-%d")
        y_stats = db.execute(
            """SELECT COUNT(*) as count, SUM(xp_awarded) as awarded 
               FROM schedule_blocks 
               WHERE user_id = ? AND day_date = ? AND block_type = 'study' AND completed = 1""",
            (user_id, yesterday)
        ).fetchone()
        
        daily_summary = {
            "yesterday_tasks": y_stats["count"] if y_stats else 0,
            "today_goal": current_user.get("neto_study_hours", 4.0)
        }

        xp_row = _get_xp_row(db, user_id)
        badges_newly_earned = check_and_award_badges(db, user_id, xp_row, streak_result)

        return {
            "first_login_today": True,
            "streak": streak_result["current_streak"],
            "longest_streak": streak_result["longest_streak"],
            "streak_broken": streak_result["streak_broken"],
            "is_milestone": bool(streak_result.get("is_milestone")),
            "morning_tasks": morning_tasks,
            "daily_summary": daily_summary,
            "badges_newly_earned": badges_newly_earned,
        }
    finally:
        db.close()


# ─── POST /gamification/award-xp ─────────────────────────────────────────────

@router.post("/award-xp")
def award_xp(body: AwardXpRequest, current_user: dict = Depends(get_current_user)):
    """Award XP for a completed schedule block."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0

    db = get_db()
    try:
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

        if block["xp_awarded"]:
            return {
                "xp_earned": 0,
                "new_total": None,
                "new_level": None,
                "level_up": False,
                "daily_xp": None,
                "badges_earned": [],
            }

        task = db.execute(
            "SELECT id, focus_score, estimated_hours FROM tasks WHERE id = ? AND user_id = ?",
            (body.task_id, user_id),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        focus_score = task["focus_score"] if task["focus_score"] is not None else 5
        estimated_hours = task["estimated_hours"] if task["estimated_hours"] is not None else 1.0
        xp_earned = calculate_xp(focus_score, estimated_hours)

        db.execute(
            "UPDATE schedule_blocks SET xp_awarded = 1 WHERE id = ? AND user_id = ?",
            (body.block_id, user_id),
        )
        db.commit()

        xp_result = update_user_xp(db, user_id, xp_earned, tz_offset)
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


# ─── POST /gamification/revoke-xp ────────────────────────────────────────────

@router.post("/revoke-xp")
def revoke_xp(body: AwardXpRequest, current_user: dict = Depends(get_current_user)):
    """Revoke XP when a block is marked undone."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0

    db = get_db()
    try:
        block = db.execute(
            """SELECT sb.id, sb.task_id, sb.xp_awarded
               FROM schedule_blocks sb
               WHERE sb.id = ? AND sb.user_id = ?""",
            (body.block_id, user_id),
        ).fetchone()

        if not block or not block["xp_awarded"]:
            return {"xp_revoked": 0}

        task = db.execute(
            "SELECT id, focus_score, estimated_hours FROM tasks WHERE id = ? AND user_id = ?",
            (block["task_id"], user_id),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        focus_score = task["focus_score"] if task["focus_score"] is not None else 5
        estimated_hours = task["estimated_hours"] if task["estimated_hours"] is not None else 1.0
        xp_to_revoke = calculate_xp(focus_score, estimated_hours)

        db.execute(
            "UPDATE schedule_blocks SET xp_awarded = 0 WHERE id = ? AND user_id = ?",
            (body.block_id, user_id),
        )
        db.commit()

        from gamification.utils import revoke_user_xp
        xp_result = revoke_user_xp(db, user_id, xp_to_revoke, tz_offset)

        return {
            "xp_revoked": xp_to_revoke,
            "new_total": xp_result["total_xp"],
            "new_level": xp_result["current_level"],
            "daily_xp": xp_result["daily_xp"],
        }
    finally:
        db.close()


# ─── POST /gamification/reschedule-task/{task_id} ────────────────────────────

@router.post("/reschedule-task/{task_id}")
def reschedule_task(task_id: int, body: RescheduleRequest, current_user: dict = Depends(get_current_user)):
    """Handle morning prompt actions for an unfinished task."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    action = body.action

    if action not in ("reschedule", "delete", "skip"):
        raise HTTPException(status_code=400, detail="action must be 'reschedule', 'delete', or 'skip'")

    db = get_db()
    try:
        task = db.execute(
            "SELECT id, title, day_date, status, user_id, estimated_hours, exam_id FROM tasks WHERE id = ? AND user_id = ?",
            (task_id, user_id),
        ).fetchone()

        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        today = _today_in_tz(tz_offset)
        target_day = today
        if body.force_tomorrow:
            target_day = (datetime.now(timezone.utc) - timedelta(minutes=tz_offset) + timedelta(days=1)).strftime("%Y-%m-%d")

        if action == "reschedule":
            db.execute(
                "UPDATE tasks SET day_date = ?, is_delayed = 1, status = 'pending' WHERE id = ? AND user_id = ?",
                (target_day, task_id, user_id),
            )
            db.execute(
                "DELETE FROM schedule_blocks WHERE task_id = ? AND user_id = ?",
                (task_id, user_id)
            )
            
            try:
                regen_result = internal_regenerate_schedule(user_id, current_user, db)
                return {
                    "status": "ok", 
                    "message": f"Task rescheduled to {target_day} and schedule balanced", 
                    "task_id": task_id, 
                    "new_date": target_day,
                    "schedule": regen_result.get("schedule")
                }
            except Exception as e:
                db.rollback()
                raise HTTPException(status_code=500, detail=f"Rescheduling failed: {str(e)}")

        elif action == "delete" or action == "skip":
            db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
            db.execute("DELETE FROM schedule_blocks WHERE task_id = ? AND user_id = ?", (task_id, user_id))
            db.commit()
            return {"message": f"Task {'deleted' if action == 'delete' else 'skipped/deleted'}", "task_id": task_id}
    finally:
        db.close()


# ─── POST /gamification/batch-reschedule ────────────────────────────────────

@router.post("/batch-reschedule")
def batch_reschedule(body: BatchRescheduleRequest, current_user: dict = Depends(get_current_user)):
    """Handle multiple task actions from the morning review at once."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    db = get_db()
    
    results = []
    today = _today_in_tz(tz_offset)
    
    try:
        needs_regen = False
        for task_id in body.task_ids:
            task = db.execute(
                "SELECT id, title, estimated_hours, exam_id FROM tasks WHERE id = ? AND user_id = ?",
                (task_id, user_id)
            ).fetchone()
            
            if not task: continue
            
            if body.action == "delete":
                db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
                db.execute("DELETE FROM schedule_blocks WHERE task_id = ? AND user_id = ?", (task_id, user_id))
                results.append({"id": task_id, "title": task["title"], "status": "deleted"})
            
            elif body.action == "reschedule":
                db.execute(
                    "UPDATE tasks SET day_date = ?, is_delayed = 1, status = 'pending' WHERE id = ? AND user_id = ?",
                    (today, task_id, user_id)
                )
                db.execute("DELETE FROM schedule_blocks WHERE task_id = ? AND user_id = ?", (task_id, user_id))
                results.append({"id": task_id, "title": task["title"], "status": "moved", "new_date": today})
                needs_regen = True
        
        if needs_regen:
            internal_regenerate_schedule(user_id, current_user, db)
        
        # Always commit any pending changes (e.g., deletions or non-regen moves)
        db.commit()

        return {"results": results}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Batch reschedule failed: {str(e)}")
    finally:
        db.close()


# ─── GET /gamification/summary ───────────────────────────────────────────────

@router.get("/summary")
def get_summary(current_user: dict = Depends(get_current_user)):
    """Return full gamification state for the dashboard."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    today = _today_in_tz(tz_offset)

    db = get_db()
    try:
        xp_row = db.execute(
            "SELECT total_xp, current_level, daily_xp, daily_xp_date, tasks_completed FROM user_xp WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if xp_row is None:
            xp_data = {"total_xp": 0, "current_level": 1, "daily_xp": 0, "daily_xp_date": today, "tasks_completed": 0}
        else:
            xp_data = dict(xp_row)
            if xp_data.get("daily_xp_date") != today:
                db.execute(
                    "UPDATE user_xp SET daily_xp = 0, daily_xp_date = ? WHERE user_id = ?",
                    (today, user_id),
                )
                db.commit()
                xp_data["daily_xp"] = 0
                xp_data["daily_xp_date"] = today

        streak_row = db.execute(
            "SELECT current_streak, longest_streak, last_login_date, streak_broken FROM user_streaks WHERE user_id = ?",
            (user_id,),
        ).fetchone()

        if streak_row is None:
            streak_data = {"current_streak": 0, "longest_streak": 0, "last_login_date": None, "streak_broken": False}
        else:
            streak_data = dict(streak_row)
            streak_data["streak_broken"] = bool(streak_data["streak_broken"])

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
