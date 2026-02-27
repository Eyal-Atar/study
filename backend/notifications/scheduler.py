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
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from server.database import get_db
from notifications.utils import send_to_user

logger = logging.getLogger(__name__)

TIMING_OFFSETS = {
    "at_start": 0,
    "2_before": 2,
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


def _parse_block_start(start_time_str: str, tz_offset_min: int) -> Optional[datetime]:
    """Parse start_time from DB to UTC datetime for comparison.

    The DB stores times in two formats:
      - "YYYY-MM-DDTHH:MM:SS" (no timezone suffix) — written by the frontend
        drag/edit PATCH using toLocalISO().  These are LOCAL times, not UTC.
      - "YYYY-MM-DDTHH:MM:SSZ" or "YYYY-MM-DDTHH:MM:SS+HH:MM" — true UTC/tz-aware.
      - "YYYY-MM-DD HH:MM:SS" (space separator, no Z) — legacy format, also local.

    tz_offset_min follows JS getTimezoneOffset() convention:
        offset = UTC − local  →  local = UTC − offset
    So to convert local→UTC:  utc_dt = local_dt - timedelta(minutes=tz_offset_min)
    """
    if not start_time_str:
        return None
    try:
        s = start_time_str.strip()
        if "T" in s:
            # Check for explicit timezone info (Z suffix or +HH:MM / -HH:MM offset)
            has_tz = s.endswith("Z") or "+" in s[10:] or (s.count("-") > 2)
            if has_tz:
                # Tz-aware: parse directly
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
                return dt.astimezone(timezone.utc)
            else:
                # No timezone info — this is a local time written by the frontend.
                # Convention matches brain/scheduler.py: UTC = local + tz_offset
                # (tz_offset follows JS getTimezoneOffset(): -120 for UTC+2)
                dt = datetime.fromisoformat(s.split(".")[0])
                utc_dt = dt + timedelta(minutes=tz_offset_min)
                return utc_dt.replace(tzinfo=timezone.utc)
        # Naive "YYYY-MM-DD HH:MM:SS" (space separator) = legacy local time
        dt = datetime.strptime(s.split(".")[0], "%Y-%m-%d %H:%M:%S")
        utc_dt = dt + timedelta(minutes=tz_offset_min)
        return utc_dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


async def _check_and_send_notifications():
    """
    Called by scheduler every minute.
    For each user, find study blocks starting within their configured notification window,
    generate a motivational message, and send a push to all their registered devices.
    """
    print(f"DEBUG: _check_and_send_notifications called at {datetime.now()}", flush=True)
    now_utc = datetime.now(timezone.utc)
    # Truncate to the minute so the window is always [HH:MM:00, HH:MM+1:00).
    # Without this, a block at 14:30:00 is missed if the scheduler fires at 14:30:15.
    now_minute_utc = now_utc.replace(second=0, microsecond=0)
    db = get_db()
    try:
        # We query all users who have at least one push subscription
        users = db.execute(
            """SELECT DISTINCT u.id, u.notif_timing, u.timezone_offset
               FROM users u
               JOIN push_subscriptions ps ON u.id = ps.user_id
               WHERE u.notif_per_task = 1"""
        ).fetchall()

        for user in users:
            user = dict(user)
            offset_min = TIMING_OFFSETS.get(user["notif_timing"] or "at_start", 0)
            tz_offset = user.get("timezone_offset") or 0

            # Window in UTC: blocks that start in [now_minute + offset, now_minute + offset + 1 min)
            window_start_utc = now_minute_utc + timedelta(minutes=offset_min)
            window_end_utc = window_start_utc + timedelta(minutes=1)

            print(f"DEBUG: Checking User {user['id']}. Window (UTC): {window_start_utc.isoformat()} to {window_end_utc.isoformat()}", flush=True)

            # User's local "today" and "tomorrow" for the day_date filter.
            # tz_offset follows JS getTimezoneOffset() convention: offset = UTC - local,
            # so local = UTC - offset  (e.g. UTC+2 → offset=-120 → local = UTC + 2h)
            now_local = now_utc - timedelta(minutes=tz_offset)
            user_today = now_local.strftime("%Y-%m-%d")
            user_tomorrow = (now_local + timedelta(days=1)).strftime("%Y-%m-%d")
            
            print(f"DEBUG: User local today: {user_today}, tomorrow: {user_tomorrow}", flush=True)

            blocks = db.execute(
                """SELECT id, task_title, exam_name, start_time FROM schedule_blocks
                   WHERE user_id = ? AND block_type IN ('study', 'hobby')
                   AND completed = 0 AND push_notified = 0
                   AND day_date IN (?, ?)""",
                (user["id"], user_today, user_tomorrow)
            ).fetchall()

            if blocks:
                print(f"DEBUG: Found {len(blocks)} candidate blocks for User {user['id']}", flush=True)
            
            for block in blocks:
                block = dict(block)
                start_utc = _parse_block_start(block["start_time"], tz_offset)
                if start_utc is None:
                    print(f"DEBUG: Failed to parse start_time {block['start_time']} for block {block['id']}", flush=True)
                    continue
                
                # CATCH-UP LOGIC:
                # Trigger if: (current_time + offset) >= block_start_time
                # AND it's not too old (within the last 30 minutes) to prevent spamming old tasks.
                # AND it hasn't been notified yet (push_notified = 0, handled in SQL query above).
                
                trigger_time_utc = start_utc - timedelta(minutes=offset_min)
                
                is_time_to_notify = trigger_time_utc <= now_utc
                is_too_old = trigger_time_utc < (now_utc - timedelta(hours=24))
                
                print(f"DEBUG: Block {block['id']} ({block['task_title']}). Start UTC: {start_utc.isoformat()}, Trigger UTC: {trigger_time_utc.isoformat()}, Now UTC: {now_utc.isoformat()}, is_time: {is_time_to_notify}, is_old: {is_too_old}", flush=True)

                if is_time_to_notify and not is_too_old:
                    task_title = block["task_title"] or "Study session"
                    subject = block["exam_name"] or "your exam"
                    
                    # Calculate actual minutes remaining (could be negative if catching up)
                    diff = start_utc - now_utc
                    mins_rem = int(diff.total_seconds() / 60)
                    
                    body = _generate_message(subject, task_title, mins_rem if mins_rem > 0 else 0)
                    title = "הלוז מתחיל 📚" if mins_rem <= 0 else "StudyFlow 📚"
                    
                    # Mark as notified immediately to prevent double-sends
                    db.execute("UPDATE schedule_blocks SET push_notified = 1 WHERE id = ?", (block["id"],))
                    db.commit()
                    
                    print(f"DEBUG: Triggering push for user {user['id']} for block {block['id']}", flush=True)
                    # Send to all devices for this user
                    send_to_user(
                        db, 
                        user["id"], 
                        title, 
                        body, 
                        url="/", 
                        block_id=block["id"]
                    )
                    logger.info(f"Triggered push for user {user['id']} for block {block['id']} (Catch-up: {mins_rem}m)")

    except Exception as e:
        logger.error(f"Notification scheduler error: {e}")
    finally:
        db.close()


def start_scheduler() -> AsyncIOScheduler:
    """Create, configure, and start the APScheduler background scheduler."""
    print("DEBUG: Calling start_scheduler()", flush=True)
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _check_and_send_notifications,
        trigger="interval",
        seconds=10,
        id="push_notification_job",
        replace_existing=True
    )
    scheduler.start()
    print("DEBUG: Scheduler started successfully", flush=True)
    logger.info("[Scheduler] Push notification scheduler started")
    return scheduler
