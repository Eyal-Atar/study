# Phase 16: PWA Push Notifications, iOS Onboarding, and Smart Triggers - Research

**Researched:** 2025-05-14
**Domain:** PWA, Web Push, iOS Standalone, FastAPI background tasks
**Confidence:** HIGH

## Summary

This phase focuses on making StudyFlow feel like a native app by implementing real-time push notifications and an iOS-specific onboarding flow. The backend already has a basic APScheduler-based notification system using `pywebpush`, but it needs refinement to support multiple devices per user and deep linking to specific schedule blocks. iOS requires special handling because Safari does not support the standard PWA installation prompt; instead, we must detect "standalone" mode and provide a manual "Add to Home Screen" guide.

**Primary recommendation:** Transition from a single `push_subscription` column in the `users` table to a dedicated `push_subscriptions` table to support multiple devices, and implement a `postMessage` bridge between the Service Worker and the frontend for smooth auto-scrolling to tasks.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Environment Detection:** Logic to detect if the app is running in standalone mode or via a mobile browser (Safari/Chrome).
- **iOS Instruction Overlay:** A guided UI overlay for iOS users explaining the "Add to Home Screen" process (Share -> Add to Home Screen) as a prerequisite for notifications.
- **Permission Trigger:** `Notification.requestPermission()` is called immediately upon the first launch from the Home Screen.
- **Task Reminders:** Push notification sent 2 minutes before a task's scheduled start time.
- **Schedule Readiness:** Instant push notification sent once the AI completes the "Roadmap" generation.
- **Foreground Handling:** If the app is open (Foreground), system banners are suppressed in favor of internal UI visual cues (e.g., flashing task card or toast message).

### Claude's Discretion
- Exact design and animation of the iOS "Add to Home Screen" instruction overlay.
- Visual style of the "Foreground" notification cue (Toast, Glow, or Badge).
- Frequency of "Re-ask" logic if a user denies notification permissions.

### Deferred Ideas (OUT OF SCOPE)
- **Snooze Button:** Direct "Snooze" action from the notification banner (moved to future phase).
- **Sound Customization:** Custom notification sounds for different task categories.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NOTIF-01 | Push notifications for study reminders | `pywebpush` + `APScheduler` implementation documented in Standard Stack. |
| NOTIF-02 | User can control notification preferences | Schema extension for `notif_timing`, `notif_per_task` included in Architecture Patterns. |
| INFRA-01 | App installable as PWA on mobile devices | iOS Standalone detection and onboarding overlay research directly enables this. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pywebpush` | 1.14.0+ | VAPID/WebPush signing | The de-facto Python library for Web Push Protocol. |
| `APScheduler` | 3.10+ | Periodic trigger checks | Robust background task scheduling within FastAPI. |
| `Service Worker API` | Living Standard | Background event handling | Required for receiving push events while the app is closed. |
| `Notifications API` | Living Standard | Displaying banners | Native OS integration for alerts. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|--------------|
| `UA-Parser-JS` | Latest | Device/OS detection | Helpful for reliable iOS vs Android detection beyond simple regex. |

**Installation:**
```bash
pip install pywebpush apscheduler
```

## Architecture Patterns

### Recommended Project Structure
```
backend/
├── notifications/
│   ├── scheduler.py     # APScheduler logic (existing)
│   ├── routes.py        # Subscription endpoints (refine for multi-device)
│   └── utils.py         # Push sending helper
frontend/
├── js/
│   └── push.js          # Client-side permission & registration logic
└── sw.js                # Push listener & Click handler (refine for deep links)
```

### Pattern 1: Multi-Device Subscription Table
Instead of a single column, use a one-to-many relationship to ensure notifications reach the user's phone, tablet, and desktop simultaneously.

```sql
CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device_name TEXT, -- e.g., "iPhone 15", "Chrome on Windows"
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### Pattern 2: Deep Linking & Scroll Bridge
The Service Worker can't directly manipulate the DOM. It must communicate with the open client or pass data via URL parameters.

**Service Worker (`sw.js`):**
```javascript
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = data.url || '/';
  const blockId = data.blockId;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          client.focus();
          if (blockId) client.postMessage({ type: 'SCROLL_TO_BLOCK', blockId });
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(blockId ? `${targetUrl}?scroll_to=${blockId}` : targetUrl);
      }
    })
  );
});
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| VAPID Key Generation | Manual crypto | `pywebpush` CLI | Ensures correct curve (P-256) and format. |
| iOS Detection | Complex regex | `window.navigator.standalone` | Official Apple-provided property for PWA state. |
| Task Scheduling | `while True` loop | `APScheduler` | Handles threading, persistence, and missed jobs gracefully. |

## Common Pitfalls

### Pitfall 1: iOS Notification Permission
**What goes wrong:** Calling `Notification.requestPermission()` in a regular Safari tab on iOS.
**Why it happens:** iOS only allows push notifications for web apps that have been **Added to Home Screen**.
**How to avoid:** Detect `!window.navigator.standalone` and show the "Onboarding Overlay" first. Only ask for permission once inside the standalone app.

### Pitfall 2: Token Expiration
**What goes wrong:** Browser push tokens can expire or become invalid (410 Gone).
**Why it happens:** User clears browser data or the browser refreshes the token.
**How to avoid:** Catch `WebPushException` in the backend. If status is `410` or `404`, delete the subscription from the DB immediately.

### Pitfall 3: Timezone Confusion
**What goes wrong:** Notifications firing at the wrong time for international users.
**Why it happens:** Server runs in UTC; user schedule is local.
**How to avoid:** Store `timezone_offset` in the `users` table and calculate the "2-minute window" by converting `now_utc` to user-local or comparing UTC start times.

## Code Examples

### iOS Standalone Detection
```javascript
const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.navigator.standalone === true;

if (isIos && !isStandalone) {
  showIosOnboardingOverlay();
} else if (isStandalone) {
  // Safe to request push permissions
  requestPushPermission();
}
```

### Backend Push Sending (Unified Helper)
```python
# backend/notifications/utils.py
from pywebpush import webpush, WebPushException
import json

def send_to_user(db, user_id, title, body, url="/", block_id=None):
    subs = db.execute("SELECT * FROM push_subscriptions WHERE user_id = ?", (user_id,)).fetchall()
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}
                },
                data=json.dumps({
                    "title": title,
                    "body": body,
                    "url": url,
                    "blockId": block_id
                }),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": f"mailto:{VAPID_CLAIMS_EMAIL}"}
            )
        except WebPushException as e:
            if e.response.status_code in (404, 410):
                db.execute("DELETE FROM push_subscriptions WHERE id = ?", (sub["id"],))
                db.commit()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Safari Push (macOS only) | Web Push Standard | iOS 16.4 (2023) | PWA push now works on iPhones! |
| Polling for notifications | Push API | Standardized | Zero battery drain when app is closed. |

## Open Questions

1. **Foreground Suppression:** The user wants to suppress system banners when the app is in the foreground.
   - *What we know:* The `push` event in the Service Worker can check if any client is `focused`.
   - *What's unclear:* Can we reliably skip `showNotification` if the user is looking at a different tab of the same app?
   - *Recommendation:* Check `client.visibilityState === 'visible'` in the `push` event. If visible, send a `postMessage` to show a toast instead of calling `showNotification`.

2. **VAPID Key Generation:**
   - *Recommendation:* Use `pywebpush` to generate keys once and store them in `.env`. Do NOT commit them to git.

## Sources

### Primary (HIGH confidence)
- [MDN Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [Apple Developer: Sending Web Push Notifications](https://developer.apple.com/documentation/usernotifications/sending_web_push_notifications)
- [PyWebPush Documentation](https://github.com/web-push-libs/pywebpush)

### Secondary (MEDIUM confidence)
- [PWA iOS Standalone Detection patterns](https://web.dev/patterns/web-app-manifest/standalone/)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Libraries are mature.
- Architecture: HIGH - Multi-device and deep-linking patterns are well-documented.
- Pitfalls: HIGH - iOS constraints are the biggest hurdle and are well-understood.

**Research date:** 2025-05-14
**Valid until:** 2025-11-14 (6 months)
