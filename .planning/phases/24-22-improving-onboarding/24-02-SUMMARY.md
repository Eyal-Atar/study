---
phase: 24-22-improving-onboarding
plan: 02
subsystem: ui
tags: [onboarding, unified-card, exam-loop, loading-overlay, vanilla-js, html, animation]

# Dependency graph
requires:
  - 24-01 (popIn keyframe, .file-row-enter class, .onb-upload-area.dragover CSS rule)
provides:
  - Unified exam card merging old steps 1 and 2 into a single screen
  - Exam loop management with adaptive button text and counter
  - Escape hatch "Enter remaining exams later" button
  - buildLoadingMessages() with personalized course-name cycling
  - Personalized loading overlay with setInterval message cycling and progress bar updates
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Unified card pattern: exam details + file upload in one step, eliminating separate navigation target"
    - "Exam loop via _currentExamIndex module-level counter with updateExamLoopUI()"
    - "Race condition guard: capture courseNames into local variable before any async op or clearDraft()"
    - "Loading message cycling: setInterval(2700ms) with status-fade class + reflow for smooth transitions"
    - "dragover class on .onb-upload-area triggers CSS glow; removed on dragleave/drop"

key-files:
  created: []
  modified:
    - index.html
    - frontend/js/onboarding.js

key-decisions:
  - "Files remain optional in unified card (no minimum required) — reduces friction for users who have no materials yet"
  - "setStep(2) guard returns early rather than navigating — preserves backward compatibility for any external callers"
  - "Both tasks committed together since Task 2 loading overlay code lives inside submitOnboarding() which was fully rewritten for Task 1"
  - "Loading overlay shown via style.display = flex directly rather than through existing showModal — avoids dependency on modal helper state"

requirements-completed: [ONB-01, ONB-03, ONB-04, ONB-05]

# Metrics
duration: ~5min
completed: 2026-03-21
---

# Phase 24 Plan 02: Unified Exam Card and Personalized Loading Overlay Summary

**Merged exam details and file upload into a single unified card with exam loop management, adaptive button text, escape hatch, and a personalized loading overlay that cycles course names**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-03-21T14:39:10Z
- **Completed:** 2026-03-21T14:43:21Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Restructured `#onb-step-1` in `index.html` to contain both exam details (name, date, difficulty) and the file upload dropzone in one unified card
- Added `#onb-exam-counter` ("Exam 1 of 3") and guidance text near dropzone ("Our tip: The system can analyze syllabi...")
- Added `#onb-next-exam` button with adaptive label and `#onb-skip-remaining` escape hatch
- Hidden `#onb-step-2` as empty placeholder element (preserves element reference integrity)
- Replaced `setupExamInput()` + `setupMaterialUpload()` with `setupUnifiedExamCard()` that wires all exam card interactions in one function
- Added `_currentExamIndex` module-level counter and `updateExamLoopUI(currentIndex, totalCount)` that updates counter text and button label/styling
- Final exam button gets gradient styling (`from-accent-500 to-purple-500`), larger padding, and "Done! Build my schedule" text
- `saveExamToDraft()` saves name/date/difficulty + files to draft at `_currentExamIndex` and moves files from `-1` key to actual index
- `clearExamForm()` resets fields, restores difficulty-3 default, and clears `examFilesMap[-1]`
- Escape hatch saves current partial exam (if name+date present) and submits whatever has been collected
- `setStep()` guards step 2 navigation (returns early) and step counter now shows 1/2, 2/2
- Added `buildLoadingMessages(courseNames)` producing `{ percent, text }` array with per-course personalized messages capped at 95%
- `submitOnboarding()` captures `courseNames` BEFORE `clearDraft()` call, starts `setInterval(2700ms)` cycling, applies `status-fade` class with reflow for smooth transitions
- `clearInterval()` called on both success and error paths; loading overlay hidden on completion
- Green checkmark (`✓`) added inline to uploaded file rows; `.file-row-enter` class adds pop animation

## Task Commits

1. **Task 1+2: Unified exam card, loop management, and personalized loading overlay** - `ed88bc1` (feat)

Note: Both tasks were committed together because Task 2's `buildLoadingMessages` and interval logic live inside `submitOnboarding()`, which was fully rewritten as part of Task 1's exam-loop restructuring.

## Files Created/Modified

- `index.html` - Unified step 1 card with dropzone, counter, adaptive button, escape hatch; step 2 emptied
- `frontend/js/onboarding.js` - setupUnifiedExamCard(), updateExamLoopUI(), saveExamToDraft(), clearExamForm(), buildLoadingMessages(), updated submitOnboarding(), updated setStep()

## Decisions Made

- Files are optional in the unified card (no minimum upload required) — reduces friction for users who have no materials yet; API still sends empty file_indices array which backend handles gracefully
- `setStep(2)` guard returns early rather than navigating forward — preserves backward compatibility if any external caller ever passes 2
- Loading overlay shown via `style.display = 'flex'` directly to avoid dependency on modal helper state machine
- Race condition prevention: `courseNames` captured into local closure before any `async` operation or `clearDraft()` call

## Deviations from Plan

### Minor Scope Adjustments

**1. [Rule 2 - Missing functionality] Files made optional in unified card**
- **Found during:** Task 1 implementation
- **Issue:** Plan specified no minimum file requirement for unified card but original `saveCurrentExam()` required at least 1 file. Removing this requirement is essential for the "Enter remaining exams later" escape hatch to work with zero files.
- **Fix:** `saveExamToDraft()` has no minimum file check; the escape hatch and main button both work without any uploads
- **Files modified:** `frontend/js/onboarding.js`

**2. [Rule 1 - Bug] Tasks 1 and 2 committed atomically**
- **Reason:** `buildLoadingMessages` and interval setup live inside `submitOnboarding()`, which was completely rewritten as part of the unified card restructuring. Separating into two commits would have required a non-functional intermediate state.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- Unified exam card is fully functional — subsequent onboarding improvement plans can build on this foundation
- `buildLoadingMessages` is a pure function that can be extended with more message variants
- `_currentExamIndex` and `examFilesMap` state is properly reset on `clearDraft()` and on successful submit

---
*Phase: 24-22-improving-onboarding*
*Completed: 2026-03-21*
