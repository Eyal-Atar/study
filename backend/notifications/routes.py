"""Push notification subscription endpoints."""

from fastapi import APIRouter, Depends, HTTPException
from server.database import get_db
from auth.utils import get_current_user
import json
import os

router = APIRouter()

VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")


@router.get("/push/vapid-public-key")
def get_vapid_key():
    """Return VAPID public key for client-side subscription."""
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push not configured")
    return {"key": VAPID_PUBLIC_KEY}


@router.post("/push/subscribe")
def subscribe(body: dict, current_user: dict = Depends(get_current_user)):
    """Store the PushSubscription JSON for this user."""
    subscription = body.get("subscription")
    if not subscription:
        raise HTTPException(status_code=400, detail="subscription required")
    db = get_db()
    try:
        db.execute(
            "UPDATE users SET push_subscription = ? WHERE id = ?",
            (json.dumps(subscription), current_user["id"])
        )
        db.commit()
    finally:
        db.close()
    return {"status": "subscribed"}


@router.delete("/push/subscribe")
def unsubscribe(current_user: dict = Depends(get_current_user)):
    """Clear the PushSubscription for this user (opt-out)."""
    db = get_db()
    try:
        db.execute("UPDATE users SET push_subscription = NULL WHERE id = ?", (current_user["id"],))
        db.commit()
    finally:
        db.close()
    return {"status": "unsubscribed"}
