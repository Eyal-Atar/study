
import json
import os
import sqlite3
from pywebpush import webpush, WebPushException
from dotenv import load_dotenv

def manual_push():
    load_dotenv('.env')
    
    db_path = 'backend/study_scheduler.db'
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get the latest subscription for User 6
    row = cursor.execute("SELECT * FROM push_subscriptions WHERE user_id = 6 ORDER BY created_at DESC LIMIT 1").fetchone()
    if not row:
        print("No subscription found for user 6")
        return

    sub_info = {
        "endpoint": row['endpoint'],
        "keys": {
            "p256dh": row['p256dh'],
            "auth": row['auth']
        }
    }

    vapid_private_key = os.environ.get("VAPID_PRIVATE_KEY")
    vapid_claims = {"sub": os.environ.get("VAPID_SUB_EMAIL", "mailto:eyal3936@gmail.com")}

    payload = json.dumps({
        "title": "Manual Push Test 🚀",
        "body": "If you see this, the .env VAPID key worked!",
        "data": {"url": "/"}
    })

    try:
        print(f"Sending push to {row['endpoint'][:50]}...")
        webpush(
            subscription_info=sub_info,
            data=payload,
            vapid_private_key=vapid_private_key,
            vapid_claims=vapid_claims
        )
        print("✅ Push sent successfully!")
    except WebPushException as ex:
        print(f"❌ Failed: {ex}")
        if ex.response:
            print(f"Response: {ex.response.text}")
    finally:
        conn.close()

if __name__ == "__main__":
    manual_push()
