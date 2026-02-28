---
status: investigating
trigger: "Investigate issue: roadmap-generation-silent-failure"
created: 2025-05-20T10:00:00Z
updated: 2025-05-20T10:00:00Z
---

## Current Focus

hypothesis: Initial evidence gathering - examining backend logs and code for roadmap generation and scheduling.
test: Check backend logs for errors during roadmap generation and scheduling. Verify database schema.
expecting: Identify error messages or missing database columns.
next_action: Search backend code for "approve-and-schedule" and "generate_roadmap" logic.

## Symptoms

expected: Auditor generates tasks from extracted syllabus; Approve & Generate Schedule successfully saves to DB and returns schedule.
actual: Sometimes no tasks generated; Approve step fails with 500/Failed message.
errors: "No tasks to approve" (frontend validation) or "Failed to generate schedule" (backend error).
reproduction: 1. Generate Roadmap -> 0 tasks. 2. Generate Roadmap -> 7 tasks -> Approve -> Failure.
started: Started after implementing Split-Brain Core Scheduler (Phase 17).

## Eliminated

## Evidence

## Resolution

root_cause: 
fix: 
verification: 
files_changed: []
