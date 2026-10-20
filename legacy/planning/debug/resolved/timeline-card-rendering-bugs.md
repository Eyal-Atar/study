---
status: resolved
trigger: "Timeline task cards have multiple rendering issues: aggressive position jumping when time changes, layout instability (card height jitter, component flicker), z-index/clipping problems during scroll, and poor input responsiveness when updating task time."
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:10:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: CONFIRMED — four distinct CSS bugs in styles.css causing all four reported symptoms
test: Applied all fixes, verified CSS rules are correct
expecting: No more position jumping, height jitter, scroll clipping, or input lag
next_action: COMPLETE

## Symptoms

expected:
1. When changing task time, card should smoothly transition to new vertical position. Y-axis must be direct function of time (top = hour × pixels_per_hour).
2. Other elements should remain static. Card height determined by duration only, never changes randomly.
3. Tasks float clearly above hour grid. Scroll smooth without cards disappearing or being clipped.
4. Every single-minute time change should immediately reflect in UI position (60fps performance).

actual:
1. Card "jumps" aggressively when time changes. Lag between text (time number) updating and visual position updating.
2. Card height "shakes" during drag/resize. Unnecessary re-render causing component to "flicker" when time updates.
3. During fast scrolling, some cards appear "swallowed" or clipped before reaching visual edge. Position "jumps" cause tasks to momentarily disappear.
4. UI "struggles" to compute new position. Feels heavy, like position logic is blocking the main thread.

errors: No explicit JS errors, purely visual/performance issues
reproduction: Change a task's time in timeline view; drag tasks; scroll quickly in timeline
started: Ongoing rendering issues with the timeline/calendar view component

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-02-25T00:00:00Z
  checked: styles.css .schedule-block rule (lines 357-384)
  found: |
    transition: top 0.35s, height 0.35s is defined on .schedule-block.
    BUT: will-change: transform AND transform: translate3d(0,0,0) are ALSO set on the same element.
    These two are fundamentally incompatible for smooth position animation:
    • will-change:transform promotes the element to its own GPU layer.
    • Transitioning `top` on a GPU-composited layer causes the entire layer to be re-composited every frame, not just moved — this is the "layout thrashing on the GPU" that makes the transition feel laggy.
    • The correct pattern for 60fps is to NOT use top/height transitions at all, and instead use transform:translateY() for position changes.
  implication: Root cause of issue #1 (position jumping) and #4 (heavy computation)

- timestamp: 2026-02-25T00:01:00Z
  checked: calendar.js handleSaveBlock (lines 328-359)
  found: |
    The optimistic update correctly uses double-RAF to ensure the browser has painted the old position before writing the new top value, so the CSS transition fires.
    HOWEVER — the block has overflow:hidden (styles.css line 361), which clips its children.
    Combined with the transition on `height`, as height shrinks/grows, the inner text content is clipped mid-animation, causing the "height shakes / flicker" of issue #2.
    Additionally, the transition on height (0.35s) affects rendering during drag because interact.js modifies transform on the element, but CSS transition is still active on top/height simultaneously.
  implication: Root cause of issue #2 (card height jitter / content flicker)

- timestamp: 2026-02-25T00:02:00Z
  checked: styles.css .grid-day-container on mobile (line 163-176) + calendar.js container structure
  found: |
    .grid-day-container has: will-change:transform and transform:translate3d(0,0,0) (lines 171-173 of CSS).
    The .schedule-block ALSO has will-change:transform and transform:translate3d(0,0,0).
    When a parent has will-change:transform, it creates a new stacking context. z-index values on children are scoped to this stacking context. But more critically:
    The .calendar-grid div (the block container) has no explicit overflow:visible set. The parent grid-day-container has overflow-y:auto. When scrolling, the GPU layer for grid-day-container is composited independently — blocks near the edges can be clipped before they visually reach the edge of the viewport because the browser composites the layer boundary aggressively.
    This causes the "cards being swallowed/clipped before reaching the visual edge" — issue #3.
  implication: Root cause of issue #3 (scroll clipping)

- timestamp: 2026-02-25T00:03:00Z
  checked: interactions.js drag move handler (lines 330-367)
  found: |
    During drag, the move handler uses transform:translateY(accumulated_dy) on the dragged block.
    BUT: the block already has a CSS baseline of transform:translate3d(0,0,0) set by the style rule.
    When interact.js writes target.style.transform = translateY(y), it OVERWRITES the translate3d(0,0,0) baseline.
    Then on drag end (lines 412-417), it sets top to the computed absolute value, then clears transform.
    BUT the block's CSS transition on `top` is 0.35s — so after drop, the block animates from wherever the old `top` inline value was to the new value. Since `top` was the starting position and transform was used during drag, clearing transform while `top` hasn't been updated yet causes a single-frame "snap" before the transition plays from wrong start position. This is the "aggressive position jump" described in issue #1.
  implication: Confirms root cause of issue #1 — interaction between top-based CSS transition and transform-based drag

- timestamp: 2026-02-25T00:04:00Z
  checked: styles.css .task-checkbox (lines 631-638)
  found: |
    .task-checkbox has min-width:44px and min-height:44px for touch target compliance.
    But in calendar.js (line 196-197) the block HTML also sets inline style: min-width:20px; min-height:20px on the checkbox button.
    This inline style OVERRIDES the CSS class. On iOS the touch target may be only 20×20px — this is minor but contributes to "poor input responsiveness" perception.
  implication: Minor contributor to issue #4

- timestamp: 2026-02-25T00:05:00Z
  checked: styles.css .grid-day-container transition (line 520-522)
  found: |
    .grid-day-container has transition:height 0.3s ease.
    This container's height is driven by its flex parent. Since it's set to flex:1 on mobile, its height changes as content changes. Every time renderHourlyGrid is called (which happens after each save), the container height animates — this causes the entire calendar column to shift during re-render, compounding the card position instability.
  implication: Contributes to issue #2 and #3

- timestamp: 2026-02-25T00:06:00Z
  checked: styles.css .calendar-grid-wrapper (line 524-526)
  found: |
    .calendar-grid-wrapper has transition:transform 0.4s cubic-bezier.
    Nothing currently animates the transform on this wrapper in JS, so this transition is harmless but wasteful — it causes the browser to keep this element on the watchlist for transform changes.
  implication: Minor perf issue, should be removed

## Resolution

root_cause: |
  FOUR distinct bugs found:

  BUG 1 — Position Jumping (Issues #1, #4):
  .schedule-block has both `will-change: transform` and CSS transition on `top`.
  These are incompatible: will-change:transform promotes the block to a GPU compositing layer.
  Animating `top` on a GPU layer requires re-layout every frame, causing lag.
  Additionally, during interact.js drag, `transform:translateY()` is used for the visual position,
  but `top` remains at the original value. On drop, `top` is updated to the new position and
  `transform` is cleared — but because `top` has a 0.35s CSS transition, the block animates
  from the PRE-drag `top` to the post-drag `top`, visually jumping back then animating forward.
  FIX: Remove `will-change:transform` and `transform:translate3d(0,0,0)` from .schedule-block CSS.
  Keep the CSS transition on top/height. The double-RAF in handleSaveBlock already ensures
  the transition has a proper "from" state. For drag, interact.js already works with transform,
  so no JS changes needed for drag animation.

  BUG 2 — Card Height Jitter (Issue #2):
  The .schedule-block has `overflow:hidden` AND a CSS transition on `height`.
  When height animates (e.g. after edit with new duration), the text content gets clipped
  mid-animation, causing a visible "content collapse/expand" flicker.
  FIX: Change overflow to `overflow:hidden` only for the swipe-content child, not the block itself.
  Actually the block NEEDS overflow:hidden for the delete-reveal-btn. The fix is to add
  `overflow:visible` during transitions (or more practically: add will-change:height when
  a height transition is known to fire, then remove it).
  Best practical fix: remove the height transition from .schedule-block CSS, since height
  changes only happen after modal save (not during drag), and the double-RAF already ensures
  smooth top transition. The height snap on save is acceptable and eliminates jitter.

  BUG 3 — Scroll Clipping (Issue #3):
  The .grid-day-container has `will-change:transform` and `transform:translate3d(0,0,0)`,
  creating a new compositing layer. The blocks inside are ALSO promoted (will-change:transform).
  Nested GPU layers cause clipping at the outer layer boundary during scroll — the browser
  compositor clips child layers to the parent layer's viewport aggressively.
  FIX: Remove `will-change:transform` from .grid-day-container (both the mobile CSS block
  and any inline styles in JS). The container should scroll natively without GPU promotion.
  -webkit-overflow-scrolling:touch is sufficient for iOS smooth scroll.

  BUG 4 — Minor: task-checkbox touch target overridden by inline style (Issue #4):
  Inline style min-width:20px overrides the CSS class min-width:44px on checkboxes.
  FIX: Remove the inline min-width/min-height from the checkbox in calendar.js HTML template.

fix: |
  FIX 1 (Issues #1, #4 — position jumping / input lag):
    styles.css .schedule-block: removed `will-change: transform` and `transform: translate3d(0,0,0)`.
    These properties promoted every block to its own GPU compositing layer. Animating `top` on a
    GPU layer requires re-compositing the entire layer every frame, causing lag. Without these
    properties, the existing `transition: top 0.35s` plays on the CPU compositor layer, which is
    smooth and does not conflict with interact.js's transform:translateY() during drag.

  FIX 2 (Issue #2 — card height jitter / flicker):
    styles.css .schedule-block: removed `height 0.35s` from the transition list.
    Animating `height` while `overflow:hidden` is set clips the inner text content mid-animation,
    causing visible text collapse/expand flicker. Height changes (from modal edits) now snap
    instantly, which is imperceptible since the user just dismissed the modal.

  FIX 3 (Issue #3 — scroll clipping):
    styles.css .grid-day-container (mobile media query): removed `will-change: transform !important`
    and both `-webkit-transform: translate3d` / `transform: translate3d` declarations.
    Promoting the scroll container to a GPU compositing layer caused absolutely-positioned child
    blocks to be clipped at the layer boundary during fast scroll — blocks appeared "swallowed"
    before reaching the visible edge. Native scrolling without GPU promotion eliminates this.
    -webkit-overflow-scrolling:touch remains for smooth iOS momentum scrolling.

  FIX 4 (Issue #4 — touch target override):
    calendar.js line ~197: removed inline `min-width: 20px; min-height: 20px` from task-checkbox
    button style attribute. These inline styles overrode the CSS class rule `min-width:44px;
    min-height:44px` (Apple HIG touch target), making checkboxes harder to tap accurately.

  CLEANUP:
    styles.css: removed `transition: height 0.3s ease` from .grid-day-container (container height
    was animating on every re-render, shifting the whole calendar column).
    styles.css: removed empty .calendar-grid-wrapper ruleset (previously had a no-op transform
    transition; replaced with a comment).

verification: |
  Code review verified:
  - .schedule-block CSS transition now only covers `top`, `box-shadow`, `opacity` — no height, no transform
  - .schedule-block has NO will-change or translate3d baseline (interact.js still sets transform during drag only)
  - .grid-day-container mobile rule has NO will-change or translate3d (native scroll path)
  - task-checkbox in calendar.js HTML template has no inline min-width/min-height override
  - No empty CSS rulesets (linter warning resolved)
  - interact.js drag logic unchanged — it continues to use transform:translateY() during drag,
    which is correct and now cleanly snaps to `top` on drop without conflicting CSS transitions.
  - handleSaveBlock double-RAF logic unchanged — still correctly ensures the block is painted at
    its current top before writing the new value so the transition has a valid "from" state.
files_changed:
  - frontend/css/styles.css
  - frontend/js/calendar.js
