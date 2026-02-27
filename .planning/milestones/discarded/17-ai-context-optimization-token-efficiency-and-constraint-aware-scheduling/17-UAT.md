# User Acceptance Testing: Phase 17 (AI Strategist & Stable Scheduling)

**Purpose:** Verify that the AI correctly decomposes tasks, the scheduler mathematically splits them around breaks, and the UI remains stable during deletions.

---

## Test Session: 2026-02-26

### Test 1: Generate Roadmap (Standard)
- **Action:** Add an exam with a syllabus PDF and click "Generate Roadmap".
- **Expectation:** Roadmap is built with granular tasks. No crashes.
- **Result:** [PENDING]

### Test 2: Zero-Data Generation
- **Action:** Add an exam WITHOUT a file and click "Generate Roadmap".
- **Expectation:** AI uses internal knowledge to generate a valid study sequence for that subject.
- **Result:** [PENDING]

### Test 3: Mathematical Task Splitting
- **Action:** Add a fixed break (e.g., Lunch 13:00-14:00) in the DB/Settings and generate roadmap.
- **Expectation:** If a task spans across 13:00, it is split into "Part 1/2" and "Part 2/2" around the break.
- **Result:** [PENDING]

### Test 4: Delete Last Exam Stability
- **Action:** Delete the only remaining exam.
- **Expectation:** "Deleting exam..." overlay appears and disappears. Roadmap and Focus list clear completely. No stuck blur.
- **Result:** [PENDING]

### Test 5: Manual Block Deletion
- **Action:** Double-tap a block and click "Delete".
- **Expectation:** Confirmation modal appears. Edit modal disappears. After confirming, block is gone and background is clickable.
- **Result:** [PENDING]

---

## Issues Found
*None yet.*
