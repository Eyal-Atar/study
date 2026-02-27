---
status: resolved
trigger: "The PWA caches old push subscriptions and fails to re-subscribe even after VAPID key rotation, leading to 403 Forbidden: BadJwtToken errors from Apple push servers."
created: 2024-05-23T12:00:00Z
updated: 2024-05-23T19:30:00Z
---

## Current Focus

hypothesis: The `checkVapidKeyMatch` function in `frontend/js/notifications.js` returned `true` incorrectly when it couldn't access or verify the VAPID key (common on Safari where `applicationServerKey` is often null).
test: Improve the robustness of the check using `localStorage` as a secondary source of truth and adopting a pessimistic approach (defaulting to re-subscribe on failure).
expecting: The PWA will now correctly detect the VAPID mismatch and force a fresh registration with the new key.
next_action: None (issue resolved)

## Symptoms

expected: Frontend should detect VAPID key change, unsubscribe old session, and register a new one.
actual: PWA held onto the old subscription; refresh didn't trigger unsubscribe.
errors: 403 Forbidden: BadJwtToken from web.push.apple.com.
reproduction: Rotate VAPID keys on backend, refresh PWA, attempt push.
started: Started after VAPID key rotation to PEM format.

## Eliminated

- hypothesis: Backend VAPID configuration error
  evidence: Derived public key from PEM matches .env; direct test with correct keys works.

## Evidence

- timestamp: 2024-05-23T12:25:00Z
  checked: frontend/js/notifications.js logic
  found: `checkVapidKeyMatch` returned `true` if `applicationServerKey` was missing or fetch failed.
  implication: Mismatches went undetected on Safari.

- timestamp: 2024-05-23T19:15:00Z
  checked: subscription in DB after refresh
  found: Subscription recycled the old `p256dh` key despite server-side deletion.
  implication: Browser state was stuck and verification logic didn't break the cycle.

## Resolution

root_cause: |
  `checkVapidKeyMatch` was too optimistic. It assumed a match (`true`) if it
  encountered any difficulty during verification (e.g. missing `applicationServerKey`
  property in Safari, or network errors). This prevented the PWA from detecting
  the backend VAPID key rotation, leaving the user stuck with a stale subscription.

fix: |
  1. Updated `subscribeToPush` to store the successful VAPID key in `localStorage`.
  2. Refined `checkVapidKeyMatch` to use `localStorage` as the primary source of truth.
  3. Adopted a pessimistic approach: if verification fails (network error, exception, 
     or missing keys), the function returns `false`, forcing a re-subscription.

verification: |
  Manual verification required: User must refresh PWA. The new pessimistic check 
  will trigger, detect the lack of matching localStorage key (or missing sub options), 
  force an unsubscribe + subscribe, and register the new key.

files_changed: [frontend/js/notifications.js]
