---
status: investigating
trigger: "roadmap-tasks-persist-after-exam-deletion"
created: 2024-05-23T12:00:00Z
updated: 2024-05-23T12:00:00Z
---

## Current Focus

hypothesis: Exam deletion does not trigger task deletion, or tasks are orphaned and frontend fails to handle missing exam reference.
test: Examine backend exam deletion logic and frontend task deletion/rendering logic.
expecting: Identify missing cascade delete or null pointer in frontend.
next_action: Examine backend exam deletion route.

## Symptoms

expected: Roadmap should be empty after deleting all exams.
actual: Tasks remain, screen blurs, app crashes.
errors: Not noticed by user.
reproduction: 1. Add exams. 2. Generate roadmap. 3. Delete all exams. 4. Observe roadmap still has tasks. 5. Attempt manual task deletion -> crash.
started: Started after Phase 17 refactor.

## Eliminated

## Evidence

## Resolution

root_cause:
fix:
verification:
files_changed: []
