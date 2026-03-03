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
        
        # We also need to send a specific message to the window via Service Worker
        # But send_to_user only sends a standard push. 
        # We'll rely on the 'data' field in the push payload being passed to the client.
        # Let's check how send_to_user handles the payload.
        
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
    """Award a flat 500 XP to the user."""
    user_id = current_user["id"]
    tz_offset = current_user.get("timezone_offset", 0) or 0
    db = get_db()
    try:
        xp_result = update_user_xp(db, user_id, 500, tz_offset)
        return {"status": "ok", "xp_result": xp_result}
    finally:
        db.close()
