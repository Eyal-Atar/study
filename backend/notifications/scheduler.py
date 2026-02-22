"""
Push notification scheduler.
Runs as a background task inside FastAPI using APScheduler.
Every minute: scans upcoming schedule_blocks, determines which users need a notification
based on their notif_timing offset, generates a Claude WhatsApp-friend message, and sends
it via Web Push using pywebpush.
"""

import json
import os
import logging
from datetime import datetime, timedelta, timezone

import anthropic
from apscheduler.schedulers.background import BackgroundScheduler
from pywebpush import webpush, WebPushException

from server.database import get_db

logger = logging.getLogger(__name__)

VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_CLAIMS_EMAIL = os.getenv("VAPID_CLAIMS_EMAIL", "admin@studyflow.app")

TIMING_OFFSETS = {
    "at_start": 0,
    "15_before": 15,
    "30_before": 30,
}

_anthropic = anthropic.Anthropic()


def _generate_message(subject: str, task_title: str, minutes_until: int) -> str:
    """Call Claude to generate a WhatsApp-friend style motivational message."""
    try:
        prompt = (
            f"Write a very short, humorous, WhatsApp-style message reminding the user about "
            f"their upcoming study session for {task_title} ({subject}) in {minutes_until} minutes. "
            f"Use emojis. Sound like a funny, slightly sarcastic friend, NOT a robot app. "
            f"Keep it under 120 characters. One sentence only."
        )
        msg = _anthropic.messages.create(
            model="claude-3-haiku-20240307",
            max_tokens=80,
            messages=[{"role": "user", "content": prompt}]
        )
        return msg.content[0].text.strip()
    except Exception as e:
        logger.warning(f"Claude message generation failed: {e}")
        return f"Hey! {task_title} in {minutes_until} min. You got this 💪"


def _send_push(subscription_json: str, title: str, body: str) -> bool:
    """Send a Web Push notification to the given subscription endpoint."""
    if not VAPID_PRIVATE_KEY:
        logger.warning("VAPID_PRIVATE_KEY not set — skipping push send")
        return False
    try:
        subscription_info = json.loads(subscription_json)
        webpush(
            subscription_info=subscription_info,
            data=json.dumps({"title": title, "body": body, "url": "/"}),
            vapid_private_key=VAPID_PRIVATE_KEY,
            vapid_claims={"sub": f"mailto:{VAPID_CLAIMS_EMAIL}"}
        )
        return True
    except WebPushException as e:
        logger.warning(f"WebPush failed: {e}")
        return False
    except Exception as e:
        logger.error(f"Push send error: {e}")
        return False


def _check_and_send_notifications():
    """
    Called by scheduler every minute.
    For each user with a push_subscription and notif_per_task=1,
    find schedule_blocks starting within the next [offset+1, offset] minutes window,
    generate a Claude message, and send a push notification.
    """
    now_utc = datetime.now(timezone.utc)
    db = get_db()
    try:
        users = db.execute(
            """SELECT id, push_subscription, notif_timing, notif_per_task, notif_daily_summary
               FROM users
               WHERE push_subscription IS NOT NULL AND notif_per_task = 1"""
        ).fetchall()

        for user in users:
            user = dict(user)
            offset_min = TIMING_OFFSETS.get(user["notif_timing"] or "at_start", 0)
            # Target: blocks starting between (now + offset) and (now + offset + 1 min)
            target_start = now_utc + timedelta(minutes=offset_min)
            window_start = target_start.strftime("%Y-%m-%dT%H:%M")
            window_end = (target_start + timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M")

            blocks = db.execute(
                """SELECT task_title, exam_name, start_time FROM schedule_blocks
                   WHERE user_id = ? AND block_type = 'study'
                   AND completed = 0
                   AND start_time >= ? AND start_time < ?""",
                (user["id"], window_start, window_end)
            ).fetchall()

            for block in blocks:
                block = dict(block)
                task_title = block["task_title"] or "Study session"
                subject = block["exam_name"] or "your exam"
                body = _generate_message(subject, task_title, offset_min if offset_min > 0 else 0)
                title = "StudyFlow 📚"
                success = _send_push(user["push_subscription"], title, body)
                if success:
                    logger.info(f"Push sent to user {user['id']} for block '{task_title}'")

    except Exception as e:
        logger.error(f"Notification scheduler error: {e}")
    finally:
        db.close()


def start_scheduler() -> BackgroundScheduler:
    """Create, configure, and start the APScheduler background scheduler."""
    scheduler = BackgroundScheduler()
    scheduler.add_job(
        _check_and_send_notifications,
        trigger="interval",
        minutes=1,
        id="push_notification_job",
        replace_existing=True
    )
    scheduler.start()
    logger.info("[Scheduler] Push notification scheduler started")
    return scheduler
