"""Debug API routes — trigger notifications, animations, and state overrides."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime, timezone, timedelta
from server.database import get_db
from auth.utils import get_current_user
from notifications.utils import send_to_user
from gamification.utils import update_user_xp, update_streak, _today_in_tz

router = APIRouter()

class TriggerRequest(BaseModel):
    action: str  # e.g., "streak-splash", "award-xp", "celebration", "new-badge"
    title: Optional[str] = "Debug Trigger"
    body: Optional[str] = "A test notification from your Mac."
    data: Optional[Any] = None

class SetStreakRequest(BaseModel):
    streak_count: int

@router.post("/trigger")
def trigger_event(body: TriggerRequest, current_user: dict = Depends(get_current_user)):
    """Send a push notification that triggers a UI action on the connected iPhone/PWA."""
    user_id = current_user["id"]
    db = get_db()
    try:
        # Prepare the push payload
        # We pass the action through so the service worker can forward it to the window
        send_to_user(
            db, 
            user_id, 
            title=body.title, 
            body=body.body, 
            url="/", 
            block_id=None,
            extra_data={
                "debug_action": body.action,
                "debug_payload": body.data
            }
        )
        
        return {"status": "ok", "message": f"Triggered {body.action} for user {user_id}"}
    finally:
        db.close()

@router.post("/set-streak")
def set_streak(body: SetStreakRequest, current_user: dict = Depends(get_current_user)):
    """Manually override the user's current streak for testing splash screens."""
    user_id = current_user["id"]
    db = get_db()
    try:
        db.execute(
            "UPDATE user_streaks SET current_streak = ?, last_login_date = ? WHERE user_id = ?",
            (body.streak_count, "2000-01-01", user_id) # Set old date so next login triggers update
        )
        db.commit()
        return {"status": "ok", "new_streak": body.streak_count}
    finally:
        db.close()

@router.post("/award-xp-debug")
def award_xp_debug(current_user: dict = Depends(get_current_user)):
    """Award a flat 500 XP to the user and trigger UI sync."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    db = get_db()
    try:
        xp_result = update_user_xp(db, user_id, 500, tz_offset)
        
        # Trigger UI update on phone
        send_to_user(
            db, user_id,
            title="XP Awarded! 🎯",
            body="You just received 500 bonus XP!",
            url="/",
            extra_data={
                "debug_action": "award-xp",
                "debug_payload": {
                    "total": xp_result["total_xp"],
                    "level": xp_result["current_level"],
                    "daily": xp_result["daily_xp"]
                }
            }
        )
        return {"status": "ok", "xp_result": xp_result}
    finally:
        db.close()

@router.post("/mark-today-done")
def mark_today_done(current_user: dict = Depends(get_current_user)):
    """Mark all of today's study blocks as completed and trigger celebration."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    today = _today_in_tz(tz_offset)
    
    db = get_db()
    try:
        db.execute(
            "UPDATE schedule_blocks SET completed = 1 WHERE user_id = ? AND day_date = ? AND block_type = 'study'",
            (user_id, today)
        )
        db.commit()
        
        # Trigger celebration on phone
        send_to_user(
            db, user_id,
            title="All Done! 🎊",
            body="Every study block for today is complete. Amazing work!",
            url="/",
            extra_data={
                "debug_action": "celebration",
                "debug_payload": None
            }
        )
        return {"status": "ok", "message": f"All study blocks for {today} marked as done."}
    finally:
        db.close()

@router.post("/reset-progress")
def reset_progress(current_user: dict = Depends(get_current_user)):
    """Reset all gamification progress (XP, streaks, badges) for the current user."""
    user_id = current_user["id"]
    db = get_db()
    try:
        db.execute("DELETE FROM user_xp WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM user_streaks WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM user_badges WHERE user_id = ?", (user_id,))
        db.execute("UPDATE schedule_blocks SET xp_awarded = 0 WHERE user_id = ?", (user_id,))
        db.commit()
        
        # Trigger UI refresh on phone
        send_to_user(
            db, user_id,
            title="Progress Reset 🔄",
            body="Your achievements have been reset for testing.",
            url="/",
            extra_data={
                "debug_action": "award-xp", # award-xp action refreshes circles
                "debug_payload": { "total": 0, "level": 1, "daily": 0 }
            }
        )
        return {"status": "ok", "message": "Progress reset successfully."}
    finally:
        db.close()

@router.post("/trigger-morning-prompt")
def trigger_morning_prompt(current_user: dict = Depends(get_current_user)):
    """Fake a new day login by setting last_login_date to yesterday and triggering the morning tasks prompt."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    db = get_db()
    try:
        # 1. Backdate the last login so the next login-check thinks it's a new day
        yesterday = (datetime.now(timezone.utc) - timedelta(minutes=tz_offset) - timedelta(days=1)).strftime("%Y-%m-%d")
        db.execute(
            "UPDATE user_streaks SET last_login_date = ? WHERE user_id = ?",
            (yesterday, user_id)
        )
        db.commit()

        # 2. Trigger the morning prompt UI on the phone immediately
        # We'll use a special debug action that calls showMorningPrompt directly
        from gamification.routes import _get_morning_tasks
        tasks = _get_morning_tasks(db, user_id, tz_offset)
        
        # If no tasks are found for 'yesterday', check if there are ANY past tasks and move them
        if not tasks:
            # Look for ANY pending task from the past
            past_task = db.execute(
                "SELECT id FROM tasks WHERE user_id = ? AND day_date < ? AND status NOT IN ('done', 'deferred') LIMIT 1",
                (user_id, yesterday)
            ).fetchone()
            
            if past_task:
                # Move them all to 'yesterday' so the prompt logic picks them up
                db.execute(
                    "UPDATE tasks SET day_date = ? WHERE user_id = ? AND day_date < ? AND status NOT IN ('done', 'deferred')",
                    (yesterday, user_id, yesterday)
                )
                db.execute(
                    "UPDATE schedule_blocks SET day_date = ? WHERE user_id = ? AND day_date < ? AND block_type = 'study'",
                    (yesterday, user_id, yesterday)
                )
                db.commit()
                # Re-fetch
                tasks = _get_morning_tasks(db, user_id, tz_offset)

        # Fallback: if STILL no real tasks found from ANY previous day, add dummy for testing
        if not tasks:
            tasks = [{
                "id": 99999,
                "title": "Test Yesterday Task",
                "subject": "Debug Mode",
                "estimated_hours": 1.5,
                "day_date": yesterday,
                "priority": 1
            }]
        
        print(f"DEBUG trigger_morning_prompt: user_id={user_id}, task_count={len(tasks)}")
        
        send_to_user(
            db, user_id,
            title="Morning Review ☕",
            body="Time to review yesterday's unfinished tasks.",
            url="/",
            extra_data={
                "debug_action": "morning-prompt",
                "debug_payload": { "tasks": tasks }
            }
        )
        return {"status": "ok", "faked_date": yesterday, "task_count": len(tasks)}
    finally:
        db.close()

@router.post("/backdate-tasks")
def backdate_tasks(current_user: dict = Depends(get_current_user)):
    """Move all of today's tasks to yesterday to make them 'unfinished' for testing."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    db = get_db()
    try:
        today = _today_in_tz(tz_offset)
        yesterday = (datetime.now(timezone.utc) - timedelta(minutes=tz_offset) - timedelta(days=1)).strftime("%Y-%m-%d")
        
        # 1. Update tasks
        db.execute(
            "UPDATE tasks SET day_date = ? WHERE user_id = ? AND day_date = ?",
            (yesterday, user_id, today)
        )
        # 2. Update schedule blocks
        db.execute(
            "UPDATE schedule_blocks SET day_date = ? WHERE user_id = ? AND day_date = ?",
            (yesterday, user_id, today)
        )
        db.commit()
        return {"status": "ok", "from": today, "to": yesterday}
    finally:
        db.close()

@router.post("/reset-onboarding")
def reset_onboarding(current_user: dict = Depends(get_current_user)):
    """Delete all exams, tasks, and schedule blocks. Reset onboarding flag."""
    user_id = current_user["id"]
    db = get_db()
    try:
        db.execute("DELETE FROM schedule_blocks WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM tasks WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM exam_files WHERE exam_id IN (SELECT id FROM exams WHERE user_id = ?)", (user_id,))
        db.execute("DELETE FROM exams WHERE user_id = ?", (user_id,))
        db.execute("UPDATE users SET onboarding_completed = 0 WHERE id = ?", (user_id,))
        db.commit()
        return {"status": "ok", "message": "Onboarding state reset. All exams, tasks, and blocks deleted."}
    finally:
        db.close()


@router.post("/restore-onboarding")
def restore_onboarding(current_user: dict = Depends(get_current_user)):
    """Re-set onboarding_completed = 1 so the user returns to the dashboard."""
    user_id = current_user["id"]
    db = get_db()
    try:
        db.execute("UPDATE users SET onboarding_completed = 1 WHERE id = ?", (user_id,))
        db.commit()
        return {"status": "ok", "message": "Onboarding flag restored. Dashboard will load on next visit."}
    finally:
        db.close()
