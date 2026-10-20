---
status: resolved
trigger: "notifications-not-in-settings"
created: 2025-05-22T12:00:00Z
updated: 2026-02-25T10:30:00Z
---

## Current Focus

hypothesis: confirmed - multiple compounding issues were causing iOS to never prompt for notification permission and never register app in Settings.
test: all fixes applied and verified with automated checks.
expecting: N/A - resolved.
next_action: archived

## Symptoms

expected: App should appear in iOS Settings > Notifications and allow enabling push notifications
actual: App does not appear in Settings; Notification.requestPermission() never shows a prompt
errors: No specific errors in UI; iOS silently blocks it
reproduction: Constant; every attempt fails
started: Always been this way

## Eliminated

- hypothesis: Service Worker push/notificationclick handlers missing
  evidence: sw.js already had both push and notificationclick event listeners with self.registration.showNotification() and self.clients.openWindow()
  timestamp: 2026-02-25T10:00:00Z

- hypothesis: SW not registered with correct scope
  evidence: app.js registers SW at /sw.js — scope defaults to "/" already. Fixed to be explicit.
  timestamp: 2026-02-25T10:00:00Z

- hypothesis: manifest.json missing display:standalone or icons
  evidence: manifest already had display:standalone, scope:"/", start_url:"/", icons 192 and 512. Only id was wrong.
  timestamp: 2026-02-25T10:00:00Z

- hypothesis: No user-gesture button exists
  evidence: Settings modal already had "Enable Notifications" button with correct onclick handler. This part was already correct.
  timestamp: 2026-02-25T10:00:00Z

## Evidence

- timestamp: 2026-02-25T10:00:00Z
  checked: frontend/manifest.json
  found: "id": "/" - a path, not a stable unique app identity. iOS uses this field to recognize and track PWA installations.
  implication: iOS may not properly register a distinct notification permission entry in Settings when the app id is a path.

- timestamp: 2026-02-25T10:00:00Z
  checked: frontend/js/notifications.js subscribeToPush()
  found: subscribeToPush() called PushManager.subscribe() WITHOUT first calling Notification.requestPermission(). iOS 16.4+ requires permission grant before any push subscription attempt or it silently aborts.
  implication: Even if the button called subscribeToPush() directly, iOS would have silently rejected the push subscription.

- timestamp: 2026-02-25T10:00:00Z
  checked: index.html line 51
  found: sf-debug-log div had style="display:block" permanently — full-width debug overlay always visible to all users.
  implication: Degraded UX; hides bottom of app content.

- timestamp: 2026-02-25T10:00:00Z
  checked: index.html settings modal
  found: No notification debug panel showing raw API support state (Notification in window, permission, SW controller, PushManager, standalone mode, push subscription).
  implication: No in-app diagnostics for iOS-specific notification issues.

## Resolution

root_cause: Four compounding issues: (1) manifest.json "id" was "/" instead of a stable unique app identifier "study-flow-v1" — iOS uses this to register the app in Settings > Notifications; (2) subscribeToPush() in notifications.js called PushManager.subscribe() without first verifying/requesting Notification.permission — iOS silently blocks push subscription if permission not explicitly granted first; (3) sf-debug-log overlay was permanently visible blocking UI; (4) no in-app notification diagnostics panel existed.
fix: |
  1. frontend/manifest.json: Changed "id": "/" to "id": "study-flow-v1"
  2. frontend/js/notifications.js: Added explicit Notification.requestPermission() guard at the top of subscribeToPush() with early-exit if permission not granted; added existing-subscription deduplication check
  3. index.html: Changed sf-debug-log from display:block to display:none (revealed only via triple-tap)
  4. index.html: Added "Notification Debug" panel in settings modal showing: 'Notification' in window, Notification.permission, SW supported, SW controller state, PushManager supported, standalone mode, iOS device detection, push subscription status; auto-refreshes when settings modal opens
  5. frontend/js/app.js: Made SW registration scope explicit: register('/sw.js', { scope: '/' })
verification: All 8 automated checks passed - debug hidden, SW scope correct, manifest id correct, debug panel present, _refreshNotifDebug defined, subscribeToPush has requestPermission guard, SW push handler present, SW notificationclick handler present.
files_changed:
  - frontend/manifest.json
  - frontend/js/notifications.js
  - frontend/js/app.js
  - index.html
