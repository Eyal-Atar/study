---
status: investigating
trigger: "Auditor call failed: Error code: 400 - {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'max_tokens: 8000 > 4096, which is the maximum allowed number of output tokens for claude-3-haiku-20240307'}}"
created: 2024-05-22T00:00:00Z
updated: 2024-05-22T00:00:00Z
---

## Current Focus

hypothesis: The Auditor call is configured with max_tokens=8000, which exceeds Haiku's limit of 4096.
test: Search codebase for "max_tokens" and "8000" or "haiku" to find the configuration.
expecting: Find a location where max_tokens is set to 8000 for a Haiku model call.
next_action: Search for "max_tokens" in the backend directory.

## Symptoms

expected: Auditor call should succeed and return JSON roadmap draft.
actual: Auditor call fails with 400 error due to max_tokens limit mismatch.
errors: Error code: 400 - max_tokens: 8000 > 4096.
reproduction: Clicking 'Generate Roadmap' in the UI triggers the Auditor call.
started: First time check for Phase 17.

## Eliminated

## Evidence

- timestamp: 2024-05-22T00:05:00Z
  checked: backend/brain/exam_brain.py and backend/brain/routes.py
  found: Multiple instances of `max_tokens=8000` being used with `claude-3-haiku-20240307`.
  implication: This is causing the 400 error because Haiku's limit is 4096.

## Resolution

root_cause: The `max_tokens` parameter for Claude 3 Haiku API calls was set to 8000, which exceeds the model's maximum allowed output tokens of 4096.
fix: Reduce `max_tokens` to 4096 in all locations where `claude-3-haiku-20240307` is used.
verification:
files_changed: []
