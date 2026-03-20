"""Gamification API routes — login-check, award-xp, reschedule-task, summary."""

from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from server.database import get_db
from auth.utils import get_current_user, verify_csrf_token
from gamification.utils import (
    calculate_xp,
    update_user_xp,
    update_streak,
    check_and_award_badges,
    _today_in_tz,
    block_duration_hours,
    xp_for_block,
)
from brain.routes import internal_regenerate_schedule

router = APIRouter(dependencies=[Depends(verify_csrf_token)])


# ─── Request/Response schemas ─────────────────────────────────────────────────

class AwardXpRequest(BaseModel):
    task_id: int | None = None
    block_id: int


class RescheduleRequest(BaseModel):
    action: str  # "reschedule" | "delete" | "skip"
    force_tomorrow: bool = False


class BatchRescheduleRequest(BaseModel):
    task_ids: list[int]
    action: str  # "reschedule" | "delete"
    delete_ids: list[int] | None = None  # optional: ids to delete in the same call


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
             AND (t.is_padding = 0 OR t.is_padding IS NULL)
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
        today = _today_in_tz(tz_offset)
        yesterday = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
        y_stats = db.execute(
            """SELECT COUNT(DISTINCT task_id) as count
               FROM schedule_blocks
               WHERE user_id = ? AND day_date = ? AND block_type = 'study' AND completed = 1 AND task_id IS NOT NULL""",
            (user_id, yesterday)
        ).fetchone()
        
        daily_summary = {
            "yesterday_tasks": y_stats["count"] if y_stats else 0,
            "today_goal": current_user.get("neto_study_hours", 4.0)
        }

        xp_row = _get_xp_row(db, user_id)
        badges_newly_earned = check_and_award_badges(db, user_id, xp_row, streak_result)

        db.commit()

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
            """SELECT sb.id, sb.task_id, sb.completed, sb.xp_awarded,
                      sb.start_time, sb.end_time
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

        xp_earned = xp_for_block(db, block, user_id)

        # Single commit: mark awarded + update XP totals + badges
        db.execute(
            "UPDATE schedule_blocks SET xp_awarded = 1 WHERE id = ? AND user_id = ?",
            (body.block_id, user_id),
        )
        xp_result = update_user_xp(db, user_id, xp_earned, tz_offset)
        streak_row = _get_streak_row(db, user_id)
        badges_earned = check_and_award_badges(db, user_id, xp_result, streak_row)
        db.commit()

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
            """SELECT sb.id, sb.task_id, sb.xp_awarded,
                      sb.start_time, sb.end_time
               FROM schedule_blocks sb
               WHERE sb.id = ? AND sb.user_id = ?""",
            (body.block_id, user_id),
        ).fetchone()

        if not block or not block["xp_awarded"]:
            return {"xp_revoked": 0}

        xp_to_revoke = xp_for_block(db, block, user_id)

        # Single commit: clear awarded flag + subtract XP
        db.execute(
            "UPDATE schedule_blocks SET xp_awarded = 0 WHERE id = ? AND user_id = ?",
            (body.block_id, user_id),
        )
        from gamification.utils import revoke_user_xp
        xp_result = revoke_user_xp(db, user_id, xp_to_revoke, tz_offset)
        db.commit()

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

        if action == "reschedule":
            # Smart reschedule: set day_date to today so the scheduler can
            # place the task in the earliest available slot (today if there's
            # capacity, otherwise it naturally overflows as an overdue task).
            # internal_regenerate_schedule syncs day_date back to the actual
            # scheduled date, so the DB stays consistent.
            db.execute(
                "UPDATE tasks SET day_date = ?, is_delayed = 1, status = 'pending' WHERE id = ? AND user_id = ?",
                (today, task_id, user_id),
            )
            db.execute(
                "DELETE FROM schedule_blocks WHERE task_id = ? AND user_id = ? AND completed = 0",
                (task_id, user_id)
            )

            try:
                regen_result = internal_regenerate_schedule(user_id, current_user, db)
                # Read back actual day_date assigned by the scheduler
                actual = db.execute(
                    "SELECT day_date FROM tasks WHERE id = ? AND user_id = ?",
                    (task_id, user_id)
                ).fetchone()
                actual_date = actual["day_date"] if actual else target_day
                return {
                    "status": "ok",
                    "message": f"Task rescheduled to {actual_date} and schedule balanced",
                    "task_id": task_id,
                    "new_date": actual_date,
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
    """Handle multiple task actions from the morning review at once.

    Supports two modes:
    1. Legacy: task_ids + action ("reschedule" or "delete") — applies same action to all.
    2. Combined: task_ids with action="reschedule" + delete_ids — reschedules task_ids
       and deletes delete_ids in a single transaction (avoids race conditions).
    """
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    db = get_db()

    results = []
    today = _today_in_tz(tz_offset)

    try:
        needs_regen = False

        # 1. Process deletions first (from delete_ids or legacy delete action)
        ids_to_delete = body.delete_ids or (body.task_ids if body.action == "delete" else [])
        for task_id in ids_to_delete:
            task = db.execute(
                "SELECT id, title FROM tasks WHERE id = ? AND user_id = ?",
                (task_id, user_id)
            ).fetchone()
            if not task: continue
            db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
            db.execute("DELETE FROM schedule_blocks WHERE task_id = ? AND user_id = ?", (task_id, user_id))
            results.append({"id": task_id, "title": task["title"], "status": "deleted"})

        # 2. Process reschedules (only when action is "reschedule")
        #    Set day_date to today so the scheduler places tasks in the
        #    earliest available slot. The scheduler's overdue logic will
        #    naturally cascade tasks to future days if today is full.
        #    internal_regenerate_schedule syncs day_date back to actual placement.
        ids_to_reschedule = body.task_ids if body.action == "reschedule" else []
        for task_id in ids_to_reschedule:
            task = db.execute(
                "SELECT id, title, estimated_hours, exam_id FROM tasks WHERE id = ? AND user_id = ?",
                (task_id, user_id)
            ).fetchone()
            if not task: continue
            db.execute(
                "UPDATE tasks SET day_date = ?, is_delayed = 1, status = 'pending' WHERE id = ? AND user_id = ?",
                (today, task_id, user_id)
            )
            db.execute("DELETE FROM schedule_blocks WHERE task_id = ? AND user_id = ? AND completed = 0", (task_id, user_id))
            results.append({"id": task_id, "title": task["title"], "status": "moved", "new_date": today})
            needs_regen = True

        # 3. Regen schedule (commits internally) then read back actual day_dates
        if needs_regen:
            internal_regenerate_schedule(user_id, current_user, db)
            # Update results with actual day_dates assigned by the scheduler
            for r in results:
                if r["status"] == "moved":
                    actual = db.execute(
                        "SELECT day_date FROM tasks WHERE id = ? AND user_id = ?",
                        (r["id"], user_id)
                    ).fetchone()
                    if actual:
                        r["new_date"] = actual["day_date"]
        else:
            # No regen needed — commit deletions directly
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
