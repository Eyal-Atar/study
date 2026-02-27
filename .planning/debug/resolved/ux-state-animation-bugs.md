---
status: resolved
trigger: "Multiple UX issues in the StudyFlow mobile calendar app after recent refactoring"
created: 2026-02-24T00:00:00Z
updated: 2026-02-24T00:05:00Z
---

## Current Focus

hypothesis: All 5 bugs investigated; 4 real bugs fixed, 1 confirmed non-issue
test: Applied targeted fixes
expecting: Verified correct in code
next_action: DONE

## Symptoms

expected:
  1. Time label on schedule block updates after edit+save (shows new start time)
  2. Block slides smoothly to new position after editing (0.4s CSS transition)
  3. Native OS time picker (wheel) for inputs in Edit and Add modals
  4. Edit/Add modals look like iOS bottom sheets (not popup boxes)
  5. NOW indicator line stays behind block text (z-index under blocks)

actual:
  1. Time text on block does NOT update after editing — old time persists until page refresh
  2. Blocks teleport instantly to new position (no smooth slide animation visible)
  3. Time inputs may not be triggering native iOS wheel properly
  4. Add Exam modal still has old popup style; Edit modal was updated but may have issues
  5. NOW line z-index may still overlap block text

errors: None reported (no console errors)
reproduction:
  - Double-tap a block → edit modal opens → change start time → Save
  - Block shows old time, teleports to new position
timeline: Always been this way / after recent UX refactoring session

## Eliminated

- hypothesis: BUG 5 — NOW line z-index overlapping block text
  evidence: |
    .current-time-line has z-index:8; .schedule-block has z-index:10. Both are children
    of .calendar-grid (same stacking context). z-index 10 > 8 means blocks paint above
    the line. will-change:transform on .grid-day-container creates a stacking context for
    the whole grid but all block/line z-indexes are compared within that same context.
    The CSS is already correct — blocks appear above the NOW line as intended.
  timestamp: 2026-02-24T00:02:00Z

## Evidence

- timestamp: 2026-02-24T00:01:00Z
  checked: calendar.js handleSaveBlock (lines 313-355) + block template (line 196-198)
  found: |
    The time display element in the block template is:
      <span class="text-sm md:text-base font-bold text-white">${startTimeStr}</span>
    inside a <div class="flex items-baseline gap-2">.
    handleSaveBlock's optimistic DOM update (original) only updated .task-title-text.
    The time label span was NEVER updated. No selector targeted it.
  implication: BUG 1 ROOT CAUSE — missing DOM update for time label span

- timestamp: 2026-02-24T00:01:00Z
  checked: styles.css .schedule-block transition (line 362) + calendar.js handleSaveBlock
  found: |
    CSS has `transition: top 0.4s cubic-bezier(...)` on .schedule-block.
    BUT handleSaveBlock wrote `blockEl.style.top = newValue` synchronously in the same
    JS task as user-gesture handling. At the point the Save button is tapped, the block
    already has its original `top` as an inline style from the initial render.
    However, if the browser hasn't yet committed a paint frame with the current top
    value when the JS overwrites it, the transition has no "from" → "to" pair to
    interpolate — it just jumps. Additionally, will-change:transform promotes the block
    to a compositor layer; writing `top` without yielding to the browser can skip the
    transition entirely on some mobile browsers.
  implication: BUG 2 ROOT CAUSE — no RAF yield before writing new top/height, browser
               never paints "from" position, transition fires with no interpolation range

- timestamp: 2026-02-24T00:01:00Z
  checked: styles.css .input-field (line 232), modal-add-exam inputs in index.html
  found: |
    .input-field CSS had NO font-size declaration. Browser default is typically 14-15px.
    iOS Safari auto-zooms and shows a non-native picker UI when font-size < 16px.
    All inputs in modal-add-exam use class `input-field` (exam-name, exam-subject,
    exam-date, exam-needs). modal-edit-task correctly uses `edit-modal-input` which
    already had font-size:16px.
  implication: BUG 3 ROOT CAUSE — missing font-size:16px on .input-field

- timestamp: 2026-02-24T00:01:00Z
  checked: index.html modal-add-exam structure vs modal-edit-task structure
  found: |
    modal-add-exam: has `modal-sheet` class (slides up correctly on mobile) BUT was
    missing the iOS drag handle pill <div class="flex justify-center pt-3 pb-1 md:hidden">
    that modal-edit-task has (lines 651-653 of original index.html).
    The visual inconsistency: edit modal has the pill indicator; add-exam modal does not.
    The modal-sheet class was already present so sliding behavior is correct.
  implication: BUG 4 ROOT CAUSE — missing drag handle pill in add-exam modal

## Resolution

root_cause: |
  BUG 1: handleSaveBlock optimistic update targeted `.task-title-text` but never
         updated the time-label span `.flex.items-baseline span.font-bold`.

  BUG 2: `blockEl.style.top = newValue` was set synchronously without a RAF delay.
         The browser had no opportunity to commit the current top position as a paint
         frame, so the CSS `transition: top 0.4s` had no "from" state — instant teleport.

  BUG 3: `.input-field` lacked `font-size:16px`, causing iOS Safari to auto-zoom on
         focus and render a non-native (non-wheel) time picker.

  BUG 4: `modal-add-exam` was missing the iOS-style drag handle pill indicator that
         gives bottom-sheet modals their native feel on mobile.

  BUG 5: NOT a real bug. z-index:8 for .current-time-line and z-index:10 for
         .schedule-block are correctly ordered; blocks paint above the NOW line.

fix: |
  calendar.js:
    - Added `const timeEl = blockEl.querySelector('.flex.items-baseline span.font-bold')`
      and sets timeEl.textContent to formatted new start time (HH:MM) immediately.
    - Wrapped the `blockEl.style.top / height` writes in a double-RAF so the browser
      commits the current frame before the transition starts.

  styles.css:
    - Added `font-size:16px` to `.input-field` rule to prevent iOS auto-zoom and
      trigger the native OS wheel time picker.

  index.html:
    - Added drag handle pill div inside modal-add-exam (md:hidden, same pattern as
      modal-edit-task) to give it consistent iOS bottom-sheet appearance.

  Version bumps:
    - styles.css: v=25 → v=26
    - All JS modules: v=21 → v=22
    - app.js entry: v=25 → v=26
    - sw.js CACHE_NAME: v21 → v22, all cached paths updated

verification: |
  Code inspection confirms:
  - Time label selector `.flex.items-baseline span.font-bold` matches the rendered HTML
    structure at calendar.js line 196-198 (div.flex.items-baseline > span.font-bold)
  - Double-RAF pattern guarantees a painted frame exists before CSS transition fires
  - font-size:16px added to .input-field prevents iOS zoom on all form modals
  - Drag handle pill in add-exam modal matches the edit-task modal pattern exactly

files_changed:
  - frontend/js/calendar.js
  - frontend/css/styles.css
  - frontend/index.html
  - frontend/js/app.js (version bump)
  - frontend/js/tasks.js (version bump)
  - frontend/js/brain.js (version bump)
  - frontend/sw.js (cache version bump)
