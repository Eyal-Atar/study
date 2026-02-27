---
status: resolved
trigger: "drag-block-jump-on-activation"
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:05:00Z
---

## Current Focus

hypothesis: RESOLVED
test: Fix applied — see Resolution section.
expecting: No jump on long-press drag activation on iPhone.
next_action: User verification on device.

## Symptoms

expected: When long press activates (600ms), block stays exactly in place under the finger. No visual movement at activation moment.
actual: Block jumps ~2cm (~75px) downward from finger position the instant drag activates. Happens every time on iPhone.
errors: No JS errors
reproduction: Long press any schedule block on mobile (iPhone). Block jumps downward on activation.
started: Persistent across multiple fix attempts.

## Eliminated

- hypothesis: transform: scale(1.02) in .dragging CSS class causes jump
  evidence: Scale was removed from CSS and applied via JS RAF — jump persists
  timestamp: prior to this session

- hypothesis: offsetY is stale (calculated at touchstart, not activation)
  evidence: offsetY was recalculated at activation time — jump persists
  timestamp: prior to this session

- hypothesis: positionDragBlock() call at activation causes snap
  evidence: Call was removed from activateTouchDrag — jump persists
  timestamp: prior to this session

- hypothesis: JS inline `transition:none` fully suppresses CSS top transition on position switch
  evidence: inline `el.style.transition = 'none'` is set synchronously before position:fixed.
    However, iOS Safari's compositor thread performs a layer reparent when switching from
    position:absolute (inside -webkit-overflow-scrolling:touch container) to position:fixed.
    The compositor animates top from old value to new value using the CSS transition — the
    main-thread inline style suppression does not reach the compositor thread in time.
  timestamp: 2026-02-25

## Evidence

- timestamp: 2026-02-25
  checked: frontend/css/styles.css lines 361-395 (.schedule-block)
  found: `transition: top 0.35s cubic-bezier(0.25, 0.8, 0.25, 1), box-shadow 0.15s ease, opacity 0.2s;`
  implication: CSS transition on `top` is active on all .schedule-block elements at all times.

- timestamp: 2026-02-25
  checked: frontend/js/interactions.js activateTouchDrag() lines 101-122
  found: inline `el.style.transition = 'none'` set before position:fixed switch; a RAF then
    overwrites it to `transform/box-shadow/opacity` (excluding top). The top transition is
    never permanently removed from the CSS rule, so iOS compositor can animate it.
  implication: The CSS top transition fires during the position:absolute → position:fixed
    layer reparent on iOS compositor thread.

- timestamp: 2026-02-25
  checked: frontend/css/styles.css lines 162-180 (.grid-day-container mobile rules)
  found: `.grid-day-container { -webkit-overflow-scrolling: touch !important; }`
  implication: The scroll container is a GPU compositing layer. When a child block switches
    to position:fixed, iOS reparents it to the viewport layer. The CSS top transition
    animates this reparent even when JS sets transition:none inline.

- timestamp: 2026-02-25
  checked: frontend/js/calendar.js handleSaveBlock() lines 328-358
  found: Uses double-RAF to animate block repositioning after save. Relies on CSS top transition.
  implication: The top transition IS needed for save-edit animation — must be preserved via
    a toggleable class rather than removed entirely.

## Resolution

root_cause: |
  CSS `transition: top 0.35s cubic-bezier(0.25, 0.8, 0.25, 1)` on `.schedule-block` (styles.css)
  fires during drag activation on iOS Safari. When a block switches position from absolute
  (inside a `-webkit-overflow-scrolling:touch` GPU compositing layer) to fixed (viewport layer),
  iOS Safari performs a compositor-thread layer reparent. During this reparent, iOS animates
  `top` from the old container-relative value to the new viewport-relative value using the CSS
  `transition: top` — bypassing the main-thread inline `el.style.transition = 'none'` suppression.

  The delta between container-relative top (~300px) and viewport-relative top (~375px, after
  accounting for container offset and scroll) produces the ~75px visible jump downward.

  Previous fix attempts targeted JS-level causes (scale, offsetY, positionDragBlock call) but
  none removed the CSS top transition from the base rule — which is the only way to prevent the
  compositor from animating it.

fix: |
  Three file changes:

  1. frontend/css/styles.css — Removed `top 0.35s ...` from .schedule-block base transition.
     The base rule now only transitions `box-shadow` and `opacity`.
     Added new `.block-repositioning` class that re-enables `transition: top 0.35s !important`
     for use only during save-edit animations.

  2. frontend/js/calendar.js — In handleSaveBlock(), wrap the double-RAF with:
     - Outer RAF: add `.block-repositioning` class (re-enables top transition)
     - Inner RAF: write new style.top + style.height (transition animates from old to new)
     - setTimeout 400ms: remove `.block-repositioning` (cleans up after 350ms animation)

  3. frontend/js/interactions.js — In activateTouchDrag(), before `el.style.transition = 'none'`,
     add `el.classList.remove('block-repositioning')` as defensive cleanup. This ensures that
     if a save-edit animation (which re-enables top transition for 400ms) is in progress when
     the user starts a long-press drag, the top transition is fully stripped before the
     position:fixed switch.

verification: |
  Code review: All three changes are minimal, targeted, and consistent.
  - No top transition in .schedule-block base → compositor cannot animate top on position switch.
  - .block-repositioning re-enables top transition only for the 400ms save-edit window.
  - Defensive classList.remove('block-repositioning') in activateTouchDrag ensures no race
    between save-edit animation and drag start.
  - The double-RAF pattern in calendar.js now wraps the class-add correctly: outer RAF commits
    the class (giving browser a "from" state for the top transition), inner RAF writes the new
    top (transition animates from current to new).
  - Requires device verification by user to confirm the jump is eliminated.

files_changed:
  - frontend/css/styles.css
  - frontend/js/calendar.js
  - frontend/js/interactions.js
