"""Push notification subscription endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from server.database import get_db
from auth.utils import get_current_user
from server.config import VAPID_PUBLIC_KEY
import json

router = APIRouter()


@router.get("/push/vapid-public-key")
def get_vapid_key():
    """Return VAPID public key for client-side subscription."""
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push not configured")
    return {"key": VAPID_PUBLIC_KEY}


@router.post("/push/subscribe")
def subscribe(body: dict, current_user: dict = Depends(get_current_user)):
    """Store the PushSubscription JSON for this user in push_subscriptions table."""
    subscription = body.get("subscription")
    if not subscription:
        raise HTTPException(status_code=400, detail="subscription required")
    
    # Extract data from standard PushSubscription object
    endpoint = subscription.get("endpoint")
    keys = subscription.get("keys", {})
    p256dh = keys.get("p256dh")
    auth = keys.get("auth")
    
    if not endpoint or not p256dh or not auth:
        raise HTTPException(status_code=400, detail="Invalid subscription format")

    db = get_db()
    try:
        # Use INSERT OR REPLACE since endpoint is UNIQUE
        db.execute(
            """
            INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth)
            VALUES (?, ?, ?, ?)
            """,
            (current_user["id"], endpoint, p256dh, auth)
        )
        db.commit()
    finally:
        db.close()
    return {"status": "subscribed"}


@router.delete("/push/subscribe")
def unsubscribe(body: dict = None, current_user: dict = Depends(get_current_user)):
    """Clear a specific PushSubscription or all for this user."""
    db = get_db()
    try:
        if body and body.get("endpoint"):
            db.execute(
                "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
                (current_user["id"], body["endpoint"])
            )
        else:
            # Opt-out: Clear all subscriptions for this user
            db.execute("DELETE FROM push_subscriptions WHERE user_id = ?", (current_user["id"],))
        db.commit()
    finally:
        db.close()
    return {"status": "unsubscribed"}


@router.post("/push/test")
def test_push(current_user: dict = Depends(get_current_user)):
    """Trigger a manual test push notification for the current user."""
    db = get_db()
    try:
        from notifications.utils import send_to_user
        send_to_user(db, current_user["id"], "Test Push 🧠", "It works! Manual push delivered successfully.")
    finally:
        db.close()
    return {"status": "test push triggered"}
