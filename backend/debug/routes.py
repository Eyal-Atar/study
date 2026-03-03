"""Debug API routes — trigger notifications, animations, and state overrides."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
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
