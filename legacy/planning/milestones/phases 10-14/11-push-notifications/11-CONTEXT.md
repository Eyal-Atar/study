# Phase 11: Push Notifications - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the app installable as a PWA and deliver Claude-powered motivational push notifications before study sessions. Covers: manifest, service worker caching, offline read-only mode, permission onboarding UX, notification settings UI, VAPID-based push backend, cron scheduling, and AI message generation. Internationalization and deployment are separate phases.

</domain>

<decisions>
## Implementation Decisions

### PWA & Offline Mode
- Create `manifest.json` for PWA: standalone display, icons, theme colors → enables "Add to Home Screen"
- Service Worker caches the App Shell (HTML/CSS/JS)
- Intercepted API requests serve last-viewed schedule JSON from IndexedDB/Cache when offline
- Offline UI: "View Only" mode — disable task editing and marking complete
- Show a small persistent "Offline" indicator when network is unavailable

### Permission & Onboarding Flow
- **Never** request push permission on initial load
- Trigger: user marks their **first** task as "Done"
- Show custom modal: *"Great job! Want a heads-up before your next session?"*
- Only if user clicks "Yes" → call native `Notification.requestPermission()`
- No specific recovery path specified — Claude's discretion for deny/dismiss handling

### Notification Settings UI
- Settings section within the existing app (not a separate page)
- **Timing Offset** dropdown: "At start time" / "15 mins before" / "30 mins before"
- **Toggles:**
  - "Notify me for every task" (per-task notification)
  - "Send Daily Morning Summary" (daily digest)
- Save user preferences **and** the `PushSubscription` object to user profile in the database

### Push Engine & AI Persona
- Web Push backend using VAPID keys
- Cron job that reads upcoming tasks filtered by each user's selected timing offset
- Before sending, call Claude to generate notification body
- **AI persona — "WhatsApp Friend" (CRITICAL):**
  - Short, humorous, slightly sarcastic WhatsApp-style message
  - Uses emojis
  - Sounds like a funny friend, NOT a robot app
  - Example prompt rule: *"Write a very short, humorous, WhatsApp-style message reminding the user about their upcoming study session for [Subject]. Use emojis. Sound like a funny, slightly sarcastic friend, NOT a robot app."*
  - Example output: *"Bro, Linear Algebra in 15 mins. Get your coffee and stop scrolling TikTok ☕💀"*
- Backend sends generated payload to Service Worker → SW displays the notification

### Claude's Discretion
- Handling when user denies or dismisses the permission modal (no recovery path specified)
- Exact icons/theme colors for manifest
- Service Worker caching strategy details (cache-first vs network-first for API calls)
- Cron job implementation approach (APScheduler, background task, etc.)
- Exact UI placement of the Settings section within the app

</decisions>

<specifics>
## Specific Ideas

- Permission trigger is explicitly on "first task marked Done" — not a timer, not a page visit count
- The "WhatsApp Friend" tone is the defining design constraint for AI notifications — humor and sarcasm are intentional, not optional
- PushSubscription must be persisted server-side so notifications fire even when the browser is closed
- Offline mode is strictly read-only — no sync or partial edit functionality needed for this phase

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-push-notifications*
*Context gathered: 2026-02-22*
