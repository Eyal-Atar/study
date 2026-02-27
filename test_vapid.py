import os
import base64
from dotenv import load_dotenv
from pywebpush import webpush, WebPushException

# Load .env from project root
load_dotenv(".env", override=True)

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PRIVATE_KEY_PATH = os.environ.get("VAPID_PRIVATE_KEY_PATH", "")
VAPID_CLAIMS = {"sub": os.environ.get("VAPID_SUB_EMAIL", "mailto:admin@studyflow.local")}

vapid_key = VAPID_PRIVATE_KEY_PATH if VAPID_PRIVATE_KEY_PATH and os.path.exists(VAPID_PRIVATE_KEY_PATH) else VAPID_PRIVATE_KEY

print(f"Using VAPID key source: {vapid_key}")

sub_info = {
    "endpoint": "https://fcm.googleapis.com/fcm/send/fake_endpoint",
    "keys": {
        "p256dh": "BLC_S9r_fake_p256dh",
        "auth": "fake_auth_token"
    }
}

try:
    print("Attempting to call webpush...")
    webpush(
        subscription_info=sub_info,
        data="{}",
        vapid_private_key=vapid_key,
        vapid_claims=dict(VAPID_CLAIMS)
    )
except WebPushException as ex:
    print(f"WebPushException: {ex}")
except Exception as e:
    print(f"Unexpected error: {e}")
