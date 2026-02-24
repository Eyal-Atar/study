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
from typing import Optional

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
    if minutes_until <= 0:
        return f"הלוז מתחיל! {task_title} — מתחילים עכשיו 📚"
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


def _parse_block_start(start_time_str: str, tz_offset_min: int) -> Optional[datetime]:
    """Parse start_time from DB (UTC iso or naive 'YYYY-MM-DD HH:MM:SS') to UTC datetime for comparison."""
    if not start_time_str:
        return None
    try:
        s = start_time_str.strip()
        if "T" in s:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        # Naive "YYYY-MM-DD HH:MM:SS" = user local from defer/edit
        dt = datetime.strptime(s.split(".")[0], "%Y-%m-%d %H:%M:%S")
        # Treat as local: convert to UTC for comparison (tz_offset_min is user offset from UTC)
        from_utc = dt - timedelta(minutes=tz_offset_min)
        return from_utc.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _check_and_send_notifications():
    """
    Called by scheduler every minute.
    For each user with a push_subscription and notif_per_task=1,
    find schedule_blocks starting within the next [offset, offset+1] minutes (in user's effective time),
    send "הלוז מתחיל" style notification when the block starts.
    """
    now_utc = datetime.now(timezone.utc)
    db = get_db()
    try:
        users = db.execute(
            """SELECT id, push_subscription, notif_timing, notif_per_task, notif_daily_summary, timezone_offset
               FROM users
               WHERE push_subscription IS NOT NULL AND notif_per_task = 1"""
        ).fetchall()

        for user in users:
            user = dict(user)
            offset_min = TIMING_OFFSETS.get(user["notif_timing"] or "at_start", 0)
            tz_offset = user.get("timezone_offset") or 0
            # Window in UTC: blocks that start between (now_utc + offset) and (now_utc + offset + 1 min)
            window_start_utc = now_utc + timedelta(minutes=offset_min)
            window_end_utc = window_start_utc + timedelta(minutes=1)
            # User's local "today" and "tomorrow" to limit rows (blocks are stored with day_date in local)
            now_local = now_utc + timedelta(minutes=tz_offset)
            user_today = now_local.strftime("%Y-%m-%d")
            user_tomorrow = (now_local + timedelta(days=1)).strftime("%Y-%m-%d")
            blocks = db.execute(
                """SELECT task_title, exam_name, start_time FROM schedule_blocks
                   WHERE user_id = ? AND block_type = 'study'
                   AND completed = 0
                   AND day_date IN (?, ?)""",
                (user["id"], user_today, user_tomorrow)
            ).fetchall()

            for block in blocks:
                block = dict(block)
                start_utc = _parse_block_start(block["start_time"], tz_offset)
                if start_utc is None:
                    continue
                if not (window_start_utc <= start_utc < window_end_utc):
                    continue
                task_title = block["task_title"] or "Study session"
                subject = block["exam_name"] or "your exam"
                body = _generate_message(subject, task_title, offset_min if offset_min > 0 else 0)
                title = "הלוז מתחיל 📚" if offset_min <= 0 else "StudyFlow 📚"
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
