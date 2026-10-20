---
status: resolved
trigger: "notification-crypto-error"
created: 2025-02-13T12:00:00Z
updated: 2025-02-13T13:30:00Z
---

## Current Focus

hypothesis: VAPID private key is malformed or in an incorrect format in the environment configuration.
test: Check the format of VAPID_PRIVATE_KEY in .env and how it is loaded in the backend.
expecting: Identify if the key is improperly encoded or contains invalid characters.
next_action: Verified fix with test_vapid.py and updated .env and generate_vapid.py.

## Symptoms

expected: Push notification is sent when the block starts.
actual: Nothing happens on the user side.
errors: `ERROR - Unexpected error sending push: Could not deserialize key data. The data may be in an incorrect format, it may be encrypted with an unsupported algorithm, or it may be an unsupported key type (e.g. EC curves with explicit parameters). Details: ASN.1 parsing error: invalid length` in `backend/scheduler_debug.log`.
reproduction: The scheduler tries to send a push (e.g., at 14:06 IST) and fails with the above error for all subscriptions.
timeline: Never worked.

## Eliminated

- hypothesis: Missing dependencies for pywebpush.
  evidence: cryptography was present, but it was being used with the wrong key format.
  timestamp: 2025-02-13T13:10:00Z

## Evidence

- timestamp: 2025-02-13T13:15:00Z
  checked: scripts/generate_vapid.py and .env
  found: VAPID_PRIVATE_KEY was in PKCS8 DER format (base64 encoded), but pywebpush expected a raw 32-byte scalar.
  implication: The ASN.1 parsing error was due to the backend trying to wrap a key that was already wrapped, or pywebpush failing to handle the PKCS8 format.

## Resolution

root_cause: VAPID_PRIVATE_KEY in .env was in PKCS8 DER format, but pywebpush (and the logic in backend/server/config.py) expected a raw 32-byte EC private key scalar.
fix: Updated scripts/generate_vapid.py to output the raw 32-byte scalar (base64url encoded), updated .env with new keys, and simplified backend/server/config.py to remove redundant DER wrapping logic.
verification: test_vapid.py now runs without ASN.1 parsing errors (it reaches the push server and returns an expected HTTP error due to fake subscription data).
files_changed: [scripts/generate_vapid.py, backend/server/config.py, .env]
