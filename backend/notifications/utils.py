import json
import logging
from pywebpush import webpush, WebPushException
from server.config import VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_CLAIMS

logger = logging.getLogger(__name__)

def send_to_user(db, user_id, title, body, url=None, block_id=None):
    """
    Send a push notification to all registered devices for a given user.
    """
    print(f"DEBUG send_to_user: user_id={user_id}, title={title}", flush=True)
    cursor = db.execute(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?",
        (user_id,)
    )
    subscriptions = cursor.fetchall()

    if not subscriptions:
        print(f"DEBUG send_to_user: No subscriptions for user {user_id}", flush=True)
        logger.info(f"No push subscriptions found for user {user_id}")
        return

    print(f"DEBUG send_to_user: Found {len(subscriptions)} subscriptions", flush=True)
    payload = {
        "title": title,
        "body": body,
        "data": {
            "url": url,
            "blockId": block_id
        }
    }
    payload_json = json.dumps(payload)

    for sub in subscriptions:
        sub_info = {
            "endpoint": sub["endpoint"],
            "keys": {
                "p256dh": sub["p256dh"],
                "auth": sub["auth"]
            }
        }

        try:
            if not VAPID_PRIVATE_KEY:
                logger.warning("VAPID_PRIVATE_KEY not set, skipping push.")
                return

            # Pass a copy of VAPID_CLAIMS so pywebpush cannot mutate the
            # module-level dict (pywebpush adds "aud" and "exp" in-place;
            # without copying, a cached "aud" from a previous endpoint leaks
            # into all subsequent calls with different endpoints).
            webpush(
                subscription_info=sub_info,
                data=payload_json,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=dict(VAPID_CLAIMS)
            )
            print(f"DEBUG PUSH: Success for {sub['endpoint']}", flush=True)
            logger.info(f"Successfully sent push to {sub['endpoint']}")
        except WebPushException as ex:
            status_code = getattr(ex.response, 'status_code', 'Unknown')
            resp_body = getattr(ex.response, 'text', 'No body')
            print(f"DEBUG PUSH: Failed. Status: {status_code}, Body: {resp_body}", flush=True)
            logger.error(f"Failed to send push Status: {status_code}, Body: {resp_body}")
            
            # Remove subscriptions that are permanently invalid:
            if status_code in [400, 403, 404, 410]:
                logger.info(
                    f"Removing stale subscription {sub['id']} "
                    f"(HTTP {ex.response.status_code})"
                )
                db.execute("DELETE FROM push_subscriptions WHERE id = ?", (sub["id"],))
                db.commit()
        except Exception as e:
            logger.error(f"Unexpected error sending push: {e}")
