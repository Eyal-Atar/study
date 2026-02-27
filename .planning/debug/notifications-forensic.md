---
status: investigating
trigger: "Notifications still don't fire. User moved a block to 1 minute in the future, waited, nothing happened."
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:00:00Z
---

## Current Focus

hypothesis: unknown - performing full forensic trace across all pipeline stages
test: reading DB state, scheduler code, server logs, frontend subscription code
expecting: identify the exact stage where the pipeline breaks
next_action: gather all evidence in parallel

## Symptoms

expected: push notification fires ~1 minute after block is moved to 1 minute in future
actual: nothing happens - no notification received
errors: none observed by user
reproduction: move a calendar block to 1 minute in the future, wait, no notification
started: ongoing - not working

## Eliminated

(none yet)

## Evidence

(gathering now)

## Resolution

root_cause:
fix:
verification:
files_changed: []
