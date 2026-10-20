---
status: investigating
trigger: "The AI calls are failing with a 404 Not Found error for model 'claude-3-5-sonnet-latest'. Previous attempts with 'claude-3-5-sonnet-20240620' and 'claude-3-5-haiku-latest' also failed."
created: 2024-12-04T19:25:00Z
updated: 2024-12-04T19:25:00Z
---

## Current Focus

hypothesis: The model name 'claude-3-5-sonnet-latest' is incorrect or the Anthropic library version is too old to support it.
test: Search for the model name in the codebase and check the Anthropic client configuration.
expecting: Find where the model name is specified and identify if it matches Anthropic's documentation for the SDK being used.
next_action: Search the codebase for "claude-3-5-sonnet-latest".

## Symptoms

expected: AI should analyze exams, identify gaps, propose tasks, and generate a schedule.
actual: Abrupt interruption, browser alert, returned to dashboard, no roadmap created.
errors: Error code: 404 - {'type': 'error', 'error': {'type': 'not_found_error', 'message': 'model: claude-3-5-sonnet-latest'}}
reproduction: Click "Generate Roadmap" in the UI.
started: Today at 19:05 PM.

## Eliminated

## Evidence

- timestamp: 2024-12-04T19:33:00Z
  checked: Tested multiple Anthropic models via scripts/test_anthropic_models.py
  found: 
    - claude-3-5-sonnet-latest: FAILED (404)
    - claude-3-5-sonnet-20241022: FAILED (404)
    - claude-3-5-sonnet-20240620: FAILED (404)
    - claude-3-5-haiku-latest: FAILED (404)
    - claude-3-opus-20240229: FAILED (404)
    - claude-3-sonnet-20240229: FAILED (404)
    - claude-3-haiku-20240307: SUCCESS
  implication: The API key/account does not have access to Claude 3.5 models or Claude 3 Opus/Sonnet. It only seems to have access to Claude 3 Haiku (specifically claude-3-haiku-20240307).

## Resolution

root_cause: 
fix: 
verification: 
files_changed: []
