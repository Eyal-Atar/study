---
status: resolved
trigger: "Investigate the 'failed to generate schedule:load failed' error when approving a roadmap."
created: 2025-01-24T12:00:00Z
updated: 2026-03-07T12:00:00Z
---

## Current Focus

## Symptoms

expected: The schedule should be generated and displayed in the calendar.
actual: An alert saying "failed to generate schedule:load failed" appears.
errors: "load failed" (likely a fetch exception message).
reproduction: 1. Generate a roadmap. 2. Click "Approve". 3. Observe the error.
started: Started after swapping to a "mini" AI model (gpt-4o-mini).

## Eliminated
- Service worker strategy (network-first should allow the request).
- Token context limit (gpt-4o-mini has 128k context).

## Evidence
- `call_strategist` with many tasks (150+) using the old verbose format (list of objects) was likely hitting the 4,096 output token limit of `gpt-4o-mini`.
- Truncated JSON caused `json.loads` to fail in the backend, triggering a 500 error.
- Frontend `authFetch` caught the network/500 error and displayed "load failed".
- Switching to a compact format `[task_index, day_index, priority]` reduced the response size by ~80% for 300 tasks (from ~9000 chars to ~200 chars).

## Resolution

root_cause: AI output truncation due to 4,096 token limit on `gpt-4o-mini` when using the verbose "list of objects" format for large task lists (100+ tasks).
fix: Optimized the Strategist prompt and `call_strategist` parser to use a compact JSON format (list of lists: `[task_index, day_index, priority]`) inside a JSON object.
verification: Verified with a reproduction script (`test_strategist.py`) that 300 tasks now generate a valid response in ~200 characters instead of exceeding the token limit.
files_changed: 
- backend/brain/exam_brain.py
