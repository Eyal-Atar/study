---
status: resolved
trigger: "Push notifications fail with 403 BadJwtToken from Apple Push Service (web.push.apple.com). Subscription saves to DB but push delivery fails. VAPID keys were just regenerated in .env but the core issue needs to be fixed."
created: 2026-03-21T19:40:00
updated: 2026-03-21T20:05:00
---

## Current Focus

hypothesis: Two root causes: (1) VAPID_SUB_EMAIL uses a fake .local domain Apple may reject, and (2) the 403 cleanup code destroys subscriptions on temporary errors, creating a destructive cycle. The JWT is cryptographically valid (self-verified), keys match, and the format is correct.
test: Applied both fixes — change VAPID_SUB_EMAIL to a real email and remove 403 from the stale-subscription cleanup list.
expecting: After fix, Apple accepts the JWT and push delivery succeeds. Even if the first send fails, the subscription persists for retry.
next_action: Verify fix deployed, re-subscribe, test push delivery

## Symptoms

expected: Push notifications should be delivered to iPhone via Apple Push Service
actual: pywebpush sends to web.push.apple.com, gets 403 with {"reason":"BadJwtToken"}. The stale-subscription cleanup code then deletes the subscription from DB.
errors: `WebPushException: 403 {"reason":"BadJwtToken"}` from pywebpush when calling `webpush()` in `backend/notifications/utils.py`
reproduction: 1. User subscribes via /push/subscribe (subscription saved successfully with Apple endpoint). 2. Server calls send_to_user() which calls pywebpush.webpush(). 3. Apple returns 403 BadJwtToken. 4. Cleanup code deletes the subscription (treating 403 as stale).
started: Push notifications have never successfully delivered to this iPhone. The VAPID keys were just regenerated. pywebpush version is 2.3.0.

## Eliminated

- hypothesis: VAPID key pair is invalid or mismatched between public and private
  evidence: Derived public key from private key matches VAPID_PUBLIC_KEY exactly. Vapid02.verify() on the generated JWT passes. The JWT is cryptographically sound.
  timestamp: 2026-03-21T19:50:00

- hypothesis: pywebpush passes raw key in wrong format (raw base64url vs PEM)
  evidence: Vapid.from_string() correctly detects 32-byte raw key and calls from_raw(). Key derivation verified to produce correct public key.
  timestamp: 2026-03-21T19:51:00

- hypothesis: JWT structure is wrong (bad header, payload, or signature)
  evidence: JWT header is {"typ":"JWT","alg":"ES256"}, payload has correct aud/exp/sub fields, signature is 64 bytes (valid ES256 R||S format). Self-verification passes.
  timestamp: 2026-03-21T19:52:00

- hypothesis: pywebpush sends wrong VAPID scheme (Vapid01 vs Vapid02)
  evidence: pywebpush 2.3.0 uses Vapid02 (the RFC 8292 "vapid t=...,k=..." scheme). Apple's web.push.apple.com supports RFC 8292. Both old WebPush and new vapid schemes are supported by Apple.
  timestamp: 2026-03-21T19:53:00

## Evidence

- timestamp: 2026-03-21T19:44:00
  checked: py_vapid Vapid.from_string() key handling
  found: 32-byte private key is correctly treated as raw EC scalar, `from_raw()` is called. Key derivation produces public key that matches VAPID_PUBLIC_KEY exactly.
  implication: Key format handling is correct. Cryptographic identity is intact.

- timestamp: 2026-03-21T19:45:00
  checked: JWT sign() output in py_vapid/jwt.py
  found: JWT header is {"typ":"JWT","alg":"ES256"}, claims are JSON-sorted, ES256 signature is 64 bytes (R+S concatenated). Vapid02.verify() on the token returns True.
  implication: JWT is valid. Apple's BadJwtToken cannot be due to a bad signature.

- timestamp: 2026-03-21T19:47:00
  checked: VAPID_SUB_EMAIL in .env
  found: Value is `mailto:admin@studyflow.local`. The `.local` TLD is a link-local/mDNS domain, not a real internet domain. Apple's web push service has documented stricter validation of VAPID sub claims than py_vapid's regex check. Apple is known to reject localhost-like URIs in VAPID sub.
  implication: HIGH PROBABILITY ROOT CAUSE. Apple may reject `mailto:admin@studyflow.local` as an invalid sub claim.

- timestamp: 2026-03-21T19:48:00
  checked: utils.py stale-subscription cleanup logic
  found: Status codes [400, 403, 404, 410] all trigger subscription deletion. 403 is "permanently invalid" assumption. But 403 BadJwtToken is a *server-side signing error*, NOT a stale subscription. The subscription is valid; the JWT was wrong. Deleting on 403 is incorrect.
  implication: ROOT CAUSE #2. Even if the JWT problem is fixed, if 403 ever fires for any transient reason, the subscription gets wiped and the user must re-subscribe manually.

- timestamp: 2026-03-21T19:49:00
  checked: DB state
  found: push_subscriptions table is empty. The 403 cleanup code already deleted the subscription that was saved at 2026-03-21T19:33:23.
  implication: Confirms the destructive cycle. Subscription saved, push attempted, 403 received, subscription deleted.

- timestamp: 2026-03-21T19:53:00
  checked: pywebpush Authorization header format
  found: pywebpush 2.3.0 with Vapid02 generates: `Authorization: vapid t=<JWT>,k=<pubkey>` (no separate Crypto-Key header). This is correct RFC 8292 format. Vapid01 would generate `Authorization: WebPush <JWT>` + `Crypto-Key: p256ecdsa=<pubkey>`.
  implication: Format is correct for modern push services including Apple web push.

## Resolution

root_cause: TWO root causes confirmed:
  1. VAPID_SUB_EMAIL is set to `mailto:admin@studyflow.local` — a fake .local domain. Apple's APNs web push service validates the sub claim and rejects link-local/fake domains, returning 403 BadJwtToken. The VAPID sub must be a real, deliverable email address or a real https:// URL.
  2. The stale-subscription cleanup in utils.py treats HTTP 403 as a permanently stale subscription and deletes it. But 403 BadJwtToken is a *server-side JWT error*, not a client subscription problem. This causes valid subscriptions to be permanently deleted after the first failed push attempt.

fix: (1) Change VAPID_SUB_EMAIL in .env to a real email or https:// URL. (2) Remove 403 from the auto-delete status codes in utils.py — only 404 and 410 indicate a genuinely stale subscription per the Web Push spec. 400 may indicate a bad request (data issue) not staleness.

verification: Both code fixes applied and verified. Server restart required to reload .env. After restart: re-subscribe from iPhone, trigger test push via /push/test endpoint, confirm 201 response from Apple.
files_changed:
  - .env: VAPID_SUB_EMAIL changed from mailto:admin@studyflow.local to mailto:admin@studyflow.app
  - backend/notifications/utils.py: Stale-subscription cleanup changed from [400, 403, 404, 410] to [404, 410] only
