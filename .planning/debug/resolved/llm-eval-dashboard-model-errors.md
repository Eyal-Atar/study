---
status: investigating
trigger: "Investigate LLM Evaluation Dashboard errors and model visibility. User reports: 1. 'only one model gives me output others print models are retriving errors', 2. 'i can see only 4 models avaliable'"
created: 2024-05-15T12:00:00Z
updated: 2024-05-15T12:00:00Z
---

## Current Focus

hypothesis: Missing or incorrect API key configuration for non-OpenRouter models, or incorrect model naming causing retrieval errors.
test: Check `backend/eval/.env` and `backend/eval/dashboard.py` model configuration.
expecting: Identify if all models are correctly prefixed and if keys are appropriately set.
next_action: gather symptoms from files

## Symptoms

expected: All configured models should be available and return output when evaluated.
actual: Only 4 models are available, and only one model returns output while others fail with retrieval errors.
errors: "models are retriving errors" (reported by user)
reproduction: Run the dashboard and attempt to evaluate with various models.
started: Unknown, first report.

## Eliminated

## Evidence

## Resolution

root_cause: 
fix: 
verification: 
files_changed: []
