
import json
import os
import sqlite3
from pywebpush import webpush, WebPushException

def manual_push_old_key():
    # THE OLD KEY
    vapid_key = "vXbHMHUz5ZEWaBC-jMxxzY5b6z9oZ9TR3lOV4k1LMgo"
    
    db_path = 'backend/study_scheduler.db'
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    row = cursor.execute("SELECT * FROM push_subscriptions WHERE user_id = 6 ORDER BY created_at DESC LIMIT 1").fetchone()
    if not row:
        print("No subscription found")
        return

    sub_info = {
        "endpoint": row['endpoint'],
        "keys": {
            "p256dh": row['p256dh'],
            "auth": row['auth']
        }
    }

    claims = {"sub": "mailto:admin@studyflow.local"}
    payload = json.dumps({"title": "Old Key Test", "body": "Testing with old key logic."})

    try:
        webpush(subscription_info=sub_info, data=payload, vapid_private_key=vapid_key, vapid_claims=claims)
        print("✅ Push sent with OLD key!")
    except WebPushException as ex:
        print(f"❌ Old key also failed: {ex}")
        if ex.response:
            print(f"Response: {ex.response.text}")
    finally:
        conn.close()

if __name__ == "__main__":
    manual_push_old_key()
