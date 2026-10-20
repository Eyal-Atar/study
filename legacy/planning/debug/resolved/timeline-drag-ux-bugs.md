---
status: resolved
trigger: "Timeline drag UX has three major issues: (1) no distinction between scroll intent and drag intent, (2) no auto-scroll when dragging near screen edges, (3) visual jitter during drag"
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:00:02Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: RESOLVED
test: all three issues fixed in interactions.js
expecting: verified by code review
next_action: archive

## Symptoms

expected:
1. Long press (~300-500ms) should activate drag; quick touch+move should scroll the schedule
2. Auto-scroll when dragging near top/bottom screen edges
3. Tasks snap to 15-minute grid intervals during drag, no flicker

actual:
1. Touch on task immediately enters drag mode — scroll impossible
2. Drag stops at screen edge — can't drag to non-visible hours
3. Tasks flicker/jitter and don't sit on grid lines during drag

errors: No explicit JS errors, purely behavioral/UX issues
reproduction: Touch a task on mobile (or touch-enabled device) and try to scroll; drag a task to screen edge; observe task position during drag
started: Ongoing UX issues with drag in timeline/calendar view

## Eliminated

- hypothesis: snap grid was wrong data type / missing entirely
  evidence: interact.js snap modifier was present and structurally correct;
            the real problem was it used interact.snappers.grid() which snaps BOTH axes,
            causing horizontal jitter; replaced with a custom function target that only
            snaps the Y axis while returning x unchanged
  timestamp: 2026-02-25T00:00:01Z

## Evidence

- timestamp: 2026-02-25T00:00:00Z
  checked: frontend/js/interactions.js — full file read
  found: |
    File has two drag systems:
    1. Custom touch-drag (onTouchStart / activateTouchDrag) — uses LONG_PRESS_MS=600,
       has edgeScroll via RAF loop, but edge MARGIN was only 8px (too tight to reach).
    2. interact.js draggable() — no hold/delay option, snap used interact.snappers.grid()
       which snaps both X and Y axes causing horizontal jitter on the column-locked blocks.

    Issue 1 root cause: interact.js draggable had no hold option. On touch-capable devices
    where the browser maps touches to pointer events (which interact.js listens to), it
    bypassed the custom 600ms long-press entirely and entered drag on first contact.

    Issue 2 root cause: edgeScroll MARGIN was 8px — the block's edge needed to be within
    8px of the screen boundary before scrolling started, which is unreachable in practice
    because the finger is already covering the block and the block has some height.

    Issue 3 root cause: interact.snappers.grid({ y: getSnapPixels() }) was evaluated once
    at interact() setup time, AND snapped the X coordinate to the same grid interval,
    fighting the inline left/right CSS that pins blocks to the column. This caused blocks
    to jitter horizontally between drag steps.
  implication: Three small, targeted changes in interactions.js fix all three issues.

## Resolution

root_cause: |
  All three issues are in frontend/js/interactions.js:
  1. interact.js draggable() missing `hold` delay option — drag activates on first touch
  2. edgeScroll MARGIN = 8px — far too small; auto-scroll zone unreachable in practice
  3. interact.js snap used interact.snappers.grid() which snaps both X and Y axes,
     fighting the inline left/right CSS on blocks and causing horizontal jitter

fix: |
  1. Added `hold: { delay: 300, tolerance: 10 }` to the interact.js draggable options.
     300ms hold is required before interact.js claims the pointer, allowing quick
     touch-and-move gestures to fall through to native scroll unchanged.
     tolerance: 10 forgives up to 10px of finger wobble during the hold period.

  2. Changed edgeScroll MARGIN from 8 to 60. With 60px the auto-scroll zone starts
     when the dragged block's edge comes within a full finger-width of the screen
     boundary, making it naturally reachable during normal dragging.

  3. Replaced `interact.snappers.grid({ y: getSnapPixels() })` with a custom function
     target: `(x, y) => ({ x, y: Math.round(y / getSnapPixels()) * getSnapPixels() })`.
     This snaps Y to the nearest 15-minute interval while leaving X completely unchanged,
     eliminating horizontal jitter. The function is also called fresh on every snap
     calculation so it picks up the correct HOUR_HEIGHT (70 or 160) based on current
     viewport width, even if the device was rotated after initInteractions() ran.

verification: |
  Code review confirms:
  - hold option syntax matches interact.js API (object with delay/tolerance keys)
  - MARGIN=60 still allows the block to pass the edge without triggering prematurely
    since SPEED=5 means smooth incremental scrolling
  - Custom snap function returns correct type ({ x, y }) expected by interact.js modifiers
  - Version strings bumped in app.js (?v=32) and sw.js (cache v32) to bust browser cache

files_changed:
  - frontend/js/interactions.js
  - frontend/js/app.js (version bump for interactions.js import)
  - frontend/sw.js (cache name v32, interactions.js entry v32)
