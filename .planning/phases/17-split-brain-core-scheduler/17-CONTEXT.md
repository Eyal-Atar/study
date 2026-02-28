# Phase 17: Split-Brain Core Intelligence Engine - Context

**Gathered:** 2026-02-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Upgrade the existing scheduling engine and Gemini integration — not a rewrite. All changes build on the current codebase (scheduler, syllabus parser, task DB schema). The core improvement is splitting the single API call into two separate calls for clean separation between content analysis (Knowledge) and time management (Temporal). The goal is a "fire and forget" experience where the core ensures all study material is covered and scheduled into a strict net-hours daily plan, accounting for cognitive load and recovery time.

</domain>

## Current State vs. Future State

| Component | Current State | Split-Core Engine (Target) |
| --- | --- | --- |
| **API Structure** | Single call generating a generic task list | **2 separate calls**: one for content strategy, one for time architecture |
| **Document Processing** | Limited scanning of file beginnings only | **Long-Context Audit**: full processing of all exam materials at once |
| **Gap Detection** | No verification of syllabus coverage | **Auditor Pass**: gap detection + clarification questions before schedule generation |
| **Net Time Enforcement** | Flexible fill with no guaranteed daily quota | **Hard Bucket Logic**: strict fill of 360 minutes (6 hours) net study per day |
| **Load Management** | Simple linear prioritization | **Focus Score** (1-10) for scheduling by required concentration level |
| **Hobbies & Breaks** | Simple default values | **Hobby & Break Anchors**: hard-locked blocks based on user DB settings |

<decisions>
## Implementation Decisions

### Model: Claude Haiku (existing API key, 2 calls)
- Same `claude-3-haiku-20240307` model already in use
- No new API keys needed — split the single call into two sequential calls
- Upgrade syllabus parser to send full PDF content (not just first 5 pages / 10K chars)

### Multi-File Upload per Exam
- Today: single PDF field per exam (syllabus only — just topic headers, not enough content)
- Target: multiple files per exam — syllabus (requirements), summaries (actual study content), sample exams (practice)
- New `exam_files` table: `exam_id`, `file_type` (syllabus/summary/sample_exam), `file_path`, `extracted_text`
- `extracted_text` saved in DB at upload time (full PyMuPDF extraction, all pages) — no re-processing needed
- The Auditor receives ALL files concatenated: syllabus defines what's needed, summaries define what's available
- Syllabus alone = topic map only. Summaries = real content for task generation. Sample exams = practice material.

### Auditor Scope: Single Call for ALL Exams
- Today: loop calling Claude per exam in isolation — no cross-exam awareness
- Target: ONE Auditor call with ALL exams + ALL their files concatenated
- Auditor sees the full picture: "Student has Calculus exam in 5 days and Data Structures in 12 days" → can prioritize and detect overlapping topics
- Claude Haiku supports 200K tokens — enough for multiple exams with full PDFs

### 1. API Call 1: The Auditor (Content Analysis)
- **Zero-Loss Audit**: Scans full syllabus against ALL summaries, identifies missing topics
- **Task Decomposition**: Breaks material into pedagogical tasks with dependencies and difficulty rating (Focus Score 1-10)
- **Gap Detection**: Compares syllabus topics vs. summary content. If a topic appears in syllabus but has no matching summary content → flag as gap → ask user "missing material on X, add a search task?"

### Intermediate Review Page (between Auditor and Strategist)
- Full-page UI showing: topic map from syllabus, detected gaps, uploaded materials coverage
- User can: approve gaps as-is, add "search for material" tasks, dismiss irrelevant gaps
- Existing users with old `parsed_context` (topics/intensity/objectives only): intermediate page lets them decide whether to re-upload files for full analysis or proceed with what they have
- If no gaps detected → page still shows topic map for review, with "Approve & Generate Schedule" button
- Only after user approval → Call 2 (Strategist) runs automatically

### 2. API Call 2: The Strategist (Time Distribution + Padding)
- **Interleaving Execution**: Receives approved task list (from ALL exams together) and distributes across the week to prevent burnout
- **Productivity Sync**: Places high focus_score tasks in the student's `peak_productivity` window (already exists in DB, default: 'Morning')
- **Padding Responsibility**: Call 2 prompt explicitly requires filling exactly 360 minutes (or `neto_study_hours`) per day. If not enough tasks → Strategist generates enrichment/padding tasks as part of its output. No third API call needed.

### 3. The Python Enforcer (Core Enforcement — no AI)
- **Strict Bucket Validation**: Python validates that Strategist output actually fills the daily quota. Safety net, not primary logic.
- **Hobby Protection**: Hobby time is a hard-locked block that never subtracts from study quota
- **Break Enforcement**: Pomodoro breaks and long breaks injected by Python, not by AI

### Trimming Logic (Overflow Handling)
- When the Strategist generates more tasks than fit in the daily quota (e.g. 12 hours for a 6-hour day):
- Strategist must assign an internal priority to each task
- If overflow occurs: lower-priority tasks are pushed to the next available day
- If no days remain before exam: alert the user "There's material for 10 hours, what should be cut?"
- The Python Enforcer validates: if day > quota, trim from bottom of priority list

### Focus Score Reasoning Persistence
- The `auditor_draft` must contain not just tasks and focus_scores, but the AI's **reasoning** for each score
- Reasoning categories: "boring/repetitive" (schedule in evening) vs. "cognitively complex" (must schedule in morning peak)
- This reasoning is passed to the Strategist so it can make informed scheduling decisions
- Stored in `auditor_draft` JSON alongside the task list

### Inter-API Failure Handling
- Since the process is split into two calls, one can succeed while the other fails
- Save Auditor output to DB (`auditor_draft` column on exams table) immediately after API Call 1
- If Strategist (API Call 2) fails: user doesn't need to redo the Audit — retry from saved draft
- UI shows: "Audit complete, scheduling failed — retry?" with one-click retry button

### Incremental Updates (Mid-Semester File Additions)
- Students upload files throughout the semester, not just once
- When a new file is added to an existing exam: run Auditor only on the new file against the existing topic map
- Update only affected tasks, don't destroy the existing schedule
- Re-run Enforcer to rebalance remaining days

### Emergency Re-plan ("Re-balance Remaining Time")
- When a student misses a study day completely
- Dashboard button: "Re-balance Remaining Time"
- Re-runs only the Enforcer on remaining incomplete tasks through remaining days until exam
- Redistributes within daily quota buckets — no new AI calls needed

### Claude's Discretion
- Prompt engineering for the two separate calls
- Database schema design for `focus_score` and `dependency_id` fields
- Error handling for API failures
- Intermediate page component layout and UX details

</decisions>

<specifics>
## Specific Implementation Roadmap

### Part 1: Split Infrastructure
1. Add `focus_score` and `dependency_id` fields to the `tasks` table in the database
2. Create `call_split_brain` function in Backend that manages the two API calls sequentially

### Part 2: API 1 — Knowledge Audit (The Auditor)
3. Implement long-context in Syllabus Parser for processing all files simultaneously
4. Build Gap Detection mechanism ensuring every syllabus topic becomes a task
5. Build the Interrogator API: surface questions to user about detected gaps before finalizing the schedule

### Part 3: API 2 — Strategic Scheduling (The Strategist)
6. Develop the second prompt that processes task list into a cognitively-balanced weekly schedule
7. Implement Interleaving logic (exam mixing) within the second API call

### Part 4: Python Enforcement (The Enforcer)
8. Rewrite `generate_multi_exam_schedule` to fill net minutes until reaching exactly the daily quota (e.g., 6 hours)
9. Sync hobby and break times as hard-locked blocks that cannot be overwritten
10. Implement automatic "padding tasks" (e.g., "solve random exam") to fill short study days

### Part 5: Dashboard Sync
11. Update XP Progress Bar to show completion percentage against the strict daily hour quota

</specifics>

<deferred>
## Deferred Ideas

- **Two-way Google Calendar sync**: Deferred until internal study engine is stabilized
- **Stress Detection (emotional analysis)**: Based on task deferral rate — to be implemented as part of a future Gamification system

</deferred>

---

*Phase: 17-split-brain-core-scheduler*
*Context gathered: 2026-02-28*
