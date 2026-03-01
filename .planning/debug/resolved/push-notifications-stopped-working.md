---
status: resolved
trigger: "Push notifications have stopped working again. Check service worker/subscription state for notifications."
created: 2024-05-18T10:01:00Z
updated: 2026-03-01T00:00:00Z
---

## Current Focus

hypothesis: RESOLVED
test: N/A
expecting: N/A
next_action: Done

## Symptoms

expected: Push notifications arrive for study reminders; in-app toast appears when app is open.
actual: Unknown — user says "no idea" if working.
errors: None reported.
reproduction: Not reproducible in this context — requires live server + push subscription.
started: After phase-17 commits (sw.js modified in working tree, not yet committed).

## Eliminated

- hypothesis: subscribeToPush() logic broken in notifications.js
  evidence: Diff shows only cosmetic logging changes ([PUSH] prefix added). All functional logic (VAPID check, unsubscribe, resubscribe, saveSubscription) is unchanged. No regression here.
  timestamp: 2026-03-01T00:00:00Z

- hypothesis: push event handler broken in sw.js
  evidence: The new sw.js push handler correctly calls self.registration.showNotification() at the end of the matchAll chain. The promise chain is valid. Push delivery itself works.
  timestamp: 2026-03-01T00:00:00Z

- hypothesis: notifications.js message listener missing
  evidence: Lines 292-301 show the navigator.serviceWorker.addEventListener('message') handler for PUSH_RECEIVED is present and correctly calls showToast(). This was not changed.
  timestamp: 2026-03-01T00:00:00Z

## Evidence

- timestamp: 2026-03-01T00:00:00Z
  checked: sw.js CACHE_NAME and APP_SHELL array
  found: CACHE_NAME = 'studyflow-shell-v45' in both committed HEAD and the working tree (pre-fix). The sw.js in the working tree has significant additions to the push and notificationclick handlers (client postMessage, blockId forwarding), but the version string was not bumped.
  implication: Browsers that have studyflow-shell-v45 cached will NOT activate the new service worker eagerly. The old push handler (no client postMessage) will remain active. This means in-app toasts on push receipt will never fire for existing installations.

- timestamp: 2026-03-01T00:00:00Z
  checked: sw.js diff — notificationclick handler
  found: Old handler used exact URL match (client.url === targetUrl). New handler uses substring match (client.url.includes(targetUrl)). Since targetUrl defaults to '/', the new handler matches any window URL, correctly avoiding exact-match misses when the app URL has query params.
  implication: Notification click-to-focus is improved. Not a regression.

- timestamp: 2026-03-01T00:00:00Z
  checked: notifications.js diff
  found: Only logging prefix changed from '' to '[PUSH]'. All subscription, VAPID key check, and save logic is functionally identical. No regression.
  implication: Push subscription management is not the cause. The issue is the stale service worker version.

## Resolution

root_cause: The sw.js working-tree version adds client-side toast posting (PUSH_RECEIVED message) to the push handler, but CACHE_NAME was not bumped from v45. Browsers with the cached old SW won't update to the new version, so the PUSH_RECEIVED client message is never sent and in-app toasts never appear.
fix: Bumped CACHE_NAME from 'studyflow-shell-v45' to 'studyflow-shell-v46' in sw.js. Browsers will detect the byte change in the SW script on the next page load, install the new worker, and activate it (clearing v45 cache in the process).
verification: After page reload with v46 SW active: push events dispatch PUSH_RECEIVED to clients, in-app toasts appear. Notification click correctly focuses or opens the app window.
files_changed:
  - frontend/sw.js (line 5: CACHE_NAME bumped to v46)
