"""Push notification subscription endpoints."""

import logging
import os
from datetime import datetime
from fastapi import APIRouter, Body, Depends, HTTPException
from server.database import get_db
from auth.utils import get_current_user
from server.config import VAPID_PUBLIC_KEY

router = APIRouter()

# File-based debug log for push operations
_PUSH_LOG = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "push_debug.log")
def _plog(msg):
    line = f"[{datetime.now().isoformat()}] {msg}"
    logging.getLogger(__name__).info(line)
    with open(_PUSH_LOG, "a") as f:
        f.write(line + "\n")


@router.get("/push/vapid-public-key")
def get_vapid_key():
    """Return VAPID public key for client-side subscription."""
    _plog(f"VAPID-KEY requested. Key set: {bool(VAPID_PUBLIC_KEY)}")
    if not VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push not configured")
    return {"key": VAPID_PUBLIC_KEY}


@router.get("/push/subscription-status")
def subscription_status(current_user: dict = Depends(get_current_user)):
    """Return whether the current user has at least one active push subscription in the DB."""
    db = get_db()
    try:
        row = db.execute(
            "SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?",
            (current_user["id"],)
        ).fetchone()
        count = row[0] if row else 0
    finally:
        db.close()
    return {"has_subscription": count > 0, "count": count}


@router.post("/push/subscribe")
def subscribe(body: dict, current_user: dict = Depends(get_current_user)):
    """Store the PushSubscription JSON for this user in push_subscriptions table."""
    _plog(f"SUBSCRIBE User {current_user['id']} — body keys: {list(body.keys())}")

    subscription = body.get("subscription")
    if not subscription:
        _plog("SUBSCRIBE FAIL: No 'subscription' key in body")
        raise HTTPException(status_code=400, detail="subscription required")

    _plog(f"SUBSCRIBE subscription keys: {list(subscription.keys())}")

    endpoint = subscription.get("endpoint")
    keys = subscription.get("keys", {})
    p256dh = keys.get("p256dh")
    auth = keys.get("auth")

    _plog(f"SUBSCRIBE endpoint: {endpoint[:80] if endpoint else 'NONE'}")
    _plog(f"SUBSCRIBE p256dh: {'SET' if p256dh else 'NONE'}, auth: {'SET' if auth else 'NONE'}")

    if not endpoint or not p256dh or not auth:
        _plog(f"SUBSCRIBE FAIL: Invalid format — endpoint={bool(endpoint)}, p256dh={bool(p256dh)}, auth={bool(auth)}")
        raise HTTPException(status_code=400, detail="Invalid subscription format")

    db = get_db()
    try:
        db.execute(
            "INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
            (current_user["id"], endpoint, p256dh, auth)
        )
        db.commit()
        count = db.execute(
            "SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?",
            (current_user["id"],)
        ).fetchone()[0]
        _plog(f"SUBSCRIBE after commit (same conn) — user {current_user['id']} has {count} sub(s)")

        # Verify with a FRESH connection to catch phantom commits
        from server.config import DB_PATH
        import sqlite3 as _sqlite3
        verify_conn = _sqlite3.connect(DB_PATH, timeout=5)
        verify_count = verify_conn.execute(
            "SELECT COUNT(*) FROM push_subscriptions WHERE user_id = ?",
            (current_user["id"],)
        ).fetchone()[0]
        verify_all = verify_conn.execute("SELECT COUNT(*) FROM push_subscriptions").fetchone()[0]
        verify_conn.close()
        _plog(f"SUBSCRIBE verify (new conn) — user {current_user['id']}: {verify_count} sub(s), total: {verify_all}")

    except Exception as e:
        _plog(f"SUBSCRIBE DB ERROR: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
    finally:
        db.close()
    return {"status": "subscribed", "count": count}


@router.delete("/push/subscribe")
def unsubscribe(body: dict = Body(default=None), current_user: dict = Depends(get_current_user)):
    """Clear a specific PushSubscription or all for this user."""
    import traceback
    _plog(f"UNSUBSCRIBE called for user {current_user['id']} — body: {body}")
    _plog(f"UNSUBSCRIBE call stack:\n{''.join(traceback.format_stack())}")
    db = get_db()
    try:
        if body and body.get("endpoint"):
            db.execute(
                "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
                (current_user["id"], body["endpoint"])
            )
        else:
            db.execute("DELETE FROM push_subscriptions WHERE user_id = ?", (current_user["id"],))
        db.commit()
        _plog(f"UNSUBSCRIBE completed for user {current_user['id']}")
    finally:
        db.close()
    return {"status": "unsubscribed"}


@router.post("/push/test")
def test_push(current_user: dict = Depends(get_current_user)):
    """Trigger a manual test push notification for the current user."""
    import logging
    logger = logging.getLogger(__name__)
    db = get_db()
    try:
        # Check subscription exists first
        subs = db.execute(
            "SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?",
            (current_user["id"],)
        ).fetchall()
        logger.info(f"[PUSH TEST] User {current_user['id']}: {len(subs)} subscription(s)")
        if not subs:
            return {"status": "no_subscription", "error": "No push subscription found. Enable notifications first."}
        for s in subs:
            logger.info(f"[PUSH TEST] Sending to sub {s['id']}: {s['endpoint'][:60]}...")
        from notifications.utils import send_to_user
        send_to_user(db, current_user["id"], "Test Push 🧠", "It works! Manual push delivered successfully.")
    finally:
        db.close()
    return {"status": "test push triggered", "subscriptions": len(subs)}


@router.get("/push/debug")
def push_debug(current_user: dict = Depends(get_current_user)):
    """Return full diagnostic info about push state for this user."""
    from server.config import VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, DB_PATH
    db = get_db()
    try:
        subs = db.execute(
            "SELECT id, endpoint, created_at FROM push_subscriptions WHERE user_id = ?",
            (current_user["id"],)
        ).fetchall()
        all_subs = db.execute("SELECT id, user_id, endpoint FROM push_subscriptions").fetchall()
        return {
            "user_id": current_user["id"],
            "db_path": DB_PATH,
            "vapid_configured": bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY),
            "subscriptions": [
                {"id": s["id"], "endpoint_prefix": s["endpoint"][:60] + "...", "created_at": s["created_at"]}
                for s in subs
            ],
            "subscription_count": len(subs),
            "all_subscriptions_count": len(all_subs),
            "all_subscriptions": [{"id": s["id"], "user_id": s["user_id"], "endpoint": s["endpoint"][:60]} for s in all_subs],
            "can_send": len(subs) > 0 and bool(VAPID_PRIVATE_KEY),
        }
    finally:
        db.close()
