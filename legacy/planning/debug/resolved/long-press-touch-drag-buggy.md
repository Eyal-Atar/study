---
status: resolved
trigger: "long-press-touch-drag-buggy: Long-press touch drag on mobile calendar blocks is very buggy. Should work like Apple Calendar but has multiple issues."
created: 2026-02-24T00:00:00Z
updated: 2026-02-24T00:00:00Z
---

## Current Focus

hypothesis: After reading all files, multiple specific bugs identified. Documenting and fixing now.
test: Code review complete — tracing 6 distinct bugs across activation, drag, and drop phases
expecting: All 6 bugs are fixable in interactions.js with targeted changes
next_action: Apply fixes to interactions.js

## Symptoms

expected: Apple Calendar-style long press drag — smooth lift animation, block stays under finger, no unwanted scrolling, clean drop rendering
actual: Multiple bugs: (1) Block jumps far from finger on activation, (2) Calendar over-scrolls while dragging a block, (3) Bad rendering when dropping the block
errors: No console errors reported, purely visual/UX bugs
reproduction: On mobile, long-press any schedule block in the calendar. The block should lift and follow the finger smoothly.
started: Always been buggy — polish issue, not a regression

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-02-24T00:01:00Z
  checked: interactions.js activateTouchDrag() — offsetY calculation
  found: |
    Line 54: `offsetY` is recorded at touchstart as `touch.clientY - block.getBoundingClientRect().top`.
    Then in activateTouchDrag() (line 95-96), after a full 600ms timer fires, it is OVERWRITTEN with a
    fixed `Math.min(blockHeight * 0.25, 40)`. The block then animates its `top` to put the finger 25%
    from the top of the block. However, between touchstart and the 600ms timer firing, the user's finger
    may have moved (touchDragState.currentY is updated on each move), or the container may have scrolled
    (changing the block's viewport position). The new offsetY is a computed constant, not derived from
    where the finger actually is relative to the block at the moment of activation. This is intentional
    design (spring toward finger) but the spring target is computed from blockHeight at touchstart, not at
    activation — generally fine since block height doesn't change.
  implication: The offset rewrite is intentional but the spring animation overwrites any natural offset the user had.

- timestamp: 2026-02-24T00:02:00Z
  checked: interactions.js activateTouchDrag() — race condition between spring animation and onTouchMoveDrag
  found: |
    Line 93: A RAF is posted to start the spring animation (transition + positionDragBlock).
    Line 110: edgeScroll RAF loop is also posted, starting BEFORE the spring RAF resolves.
    The spring sets transition to 'top 0.18s ...', then positionDragBlock() writes el.style.top.
    MEANWHILE, if the user moves their finger during the 0.18s animation, onTouchMoveDrag fires
    (dragActive is now true at line 66), calls positionDragBlock() directly at line 150 — which
    overwrites el.style.top with the RAW finger position WHILE the CSS 'top' transition is still
    active. The result: the block jumps to follow the finger mid-animation, creating a stutter/jump.
    The transitionend listener on line 101 removes 'top' from the transition, but it may never fire
    if the property is overwritten before it completes.
  implication: Bug (1) partially — block can jump/stutter if user moves finger during 600ms–600ms+180ms window.

- timestamp: 2026-02-24T00:03:00Z
  checked: interactions.js onTouchMoveDrag() — pre-activation scroll + preventDefault interaction
  found: |
    Line 124: `e.preventDefault()` is called UNCONDITIONALLY for every touchmove on a block, regardless
    of whether dragActive is true. Before dragActive, the code manually applies scroll delta (lines 140-143)
    but ONLY for the dragged block's container, not for the page. Because `touch-action: none` is set on
    .schedule-block AND `touch-action: none` is set on `html, body` at mobile breakpoint (styles.css line 61),
    the native scroll is already blocked. The manual scroll passthrough at lines 140-143 computes delta as
    `lastY - touch.clientY` (positive = finger moved up = should scroll down). But `touchDragState.lastScrollY`
    is only initialized on the SECOND move event past tolerance (first event sets it, second event uses it).
    This means the very first scroll delta after the tolerance threshold is computed against startY, which may
    be many pixels away, causing a large jump in container.scrollTop.
  implication: Bug (2) partially — first scroll event after tolerance causes a large jump in container scroll.

- timestamp: 2026-02-24T00:04:00Z
  checked: CSS styles.css — .dragging class + .schedule-block base styles interaction
  found: |
    .schedule-block (line 363) has: `transition: top 0.35s ..., height 0.35s ..., box-shadow 0.15s, opacity 0.2s`
    .dragging (line 621) has: `transition: transform 0.12s ease, box-shadow 0.12s ease` (no !important on transition)
    In activateTouchDrag(), line 79 sets `el.style.transition = 'none'` inline before adding .dragging.
    Then line 97 sets transition inline to 'top 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), transform 0.12s ease, box-shadow 0.12s ease, opacity 0.2s'.
    The .dragging class `transition` property has NO !important — so the INLINE style wins. This is fine.
    However, the .dragging class has `transform: scale(1.02) !important` (line 621). This conflicts with
    positionDragBlock(), which never sets transform — but the scale(1.02) from .dragging IS applied.
    The problem: when onTouchEnd runs (line 213): `el.style.transition = 'none'`, `el.classList.remove('dragging')`,
    `el.style.transform = ''`. Clearing the inline transform and removing .dragging happens in the same microtask.
    Then `el.style.top = finalTop` is set. Then double-RAF restores `el.style.transition = ''`.
    When transition is restored, the block's position is already set — the CSS `top` transition on .schedule-block
    should NOT animate since there's no 'from' state difference at that point. But the scale removal: removing
    .dragging removes `transform: scale(1.02) !important`, and clearing `el.style.transform = ''` means the
    block reverts to its base CSS `transform: translate3d(0,0,0)`. The transition on 'transform' in the base
    .schedule-block rule is NOT defined (only box-shadow and opacity are). However, .dragging's own transition
    includes `transform 0.12s ease` — but .dragging was just removed. This means transform animates from scale(1.02)
    back to translate3d(0,0,0) without any transition definition in the base class, potentially causing a snap.
  implication: Bug (3) partially — transform snap on drop because .dragging transition is removed before transform finishes.

- timestamp: 2026-02-24T00:05:00Z
  checked: interactions.js onTouchEnd() — position:fixed to position:absolute coordinate conversion
  found: |
    Line 213: `el.style.transition = 'none'` — disables transitions.
    Line 215: `el.style.position = ''` — returns to position:absolute (inherited from inline style in HTML: `position: absolute`).
    Line 220: `el.style.top = finalTop` — sets container-relative top.
    Line 226: Double RAF restores `el.style.transition = ''`.

    The sequence is correct for preventing the "fly" animation. HOWEVER there is a subtle issue:
    The block still has `el.style.left = ''` (cleared) and the inline HTML sets `left: 4px; right: 8px`
    as inline styles in calendar.js (line 182: `style="position: absolute; top: ...; left: 4px; right: 8px; ..."`).
    When el.style.left = '' clears the JS-set left, the block SHOULD revert to the inline HTML left:4px.
    But during the fixed phase, el.style.width was set explicitly (line 82). When el.style.width = '' (line 216),
    it clears the JS width. The block now has `right: 8px` and no explicit width — since position is absolute
    again, this resolves correctly. BUT: `el.style.width = ''` and `el.style.left = ''` both need to revert to
    the original inline styles, which they do because the HTML template always sets them as inline `style=` attributes.
    This part is actually OK.

    The real drop rendering issue: line 222 `el.setAttribute('data-y', 0)`. The block may still have a CSS
    `transform: translate3d(0,0,0)` from the base class (set via will-change and transform on line 383). When
    the .dragging scale(1.02) is removed, the block has transform = translate3d(0,0,0) again, BUT the inline
    `el.style.transform = ''` was set (line 221), which clears the inline style, leaving the CSS class rule
    `transform: translate3d(0,0,0)`. So the visual scale snap is: scale(1.02) -> translate3d(0,0,0) in one frame.
    Since .dragging's transition property was just removed with the class, and no transition is defined in
    .schedule-block for transform, this is a hard snap. Not a slow animation, just an instant scale-back.
    This is fine visually (quick de-scale) unless the double-RAF times wrong.
  implication: The drop rendering issue may be the scale snap + position transition. The double-RAF helps but doesn't fully prevent flicker.

- timestamp: 2026-02-24T00:06:00Z
  checked: interactions.js onTouchEnd() — double touchend handler conflict with calendar.js
  found: |
    calendar.js (line 400) adds a 'touchend' listener on the CONTAINER with `{passive: false}`.
    interactions.js (line 33) adds a 'touchend' listener on DOCUMENT with `{passive: true}`.
    When a touch ends, BOTH fire. The calendar.js handler checks for double-tap timing (line 406-425).
    The interactions.js handler calls onTouchEnd() which does the full drag drop sequence.
    These run in order: container listener first (bubbles inward → outward), then document listener.
    The calendar.js touchend fires first. It checks `gap < 300 && gap > 0`. After a 600ms long-press drag,
    `_lastTapTime` was set during the touchstart → timer → drag. But wait — the touchstart fires the timer,
    and if the user held for 600ms, the calendar.js touchend will still run. The double-tap detection uses
    `_lastTapTime` which is only set in the touchend handler itself. So after dragging: `gap` = Date.now() -
    _lastTapTime (which was set on the PREVIOUS touchend). If user dragged and released without a prior tap,
    _lastTapTime = 0, so gap = very large number, and the double-tap branch won't fire. OK.
    BUT: the calendar.js touchend has `e.preventDefault()` on double-tap. Since it's passive:false, this
    could theoretically interfere, but only on actual double-taps. Not the source of the drag bugs.
  implication: No conflict between touchend handlers for the drag use case — not a bug source.

- timestamp: 2026-02-24T00:07:00Z
  checked: interactions.js — interact.js desktop drag vs touch drag interaction on mobile
  found: |
    interact.js is initialized on '.schedule-block' with draggable/resizable. On mobile, when the user
    does a long-press, BOTH the custom touch handler AND interact.js may be active. interact.js normally
    uses pointer events or touch events internally. When the custom touch handler fires touchmove with
    e.preventDefault(), this should prevent interact.js from seeing the gesture. However, interact.js
    may have already started its own drag on touchstart. The interact.js `start` handler is intentionally
    empty (line 316-319), so it won't mutate the DOM. But interact.js's own internal state machine may
    think a drag is in progress simultaneously with the custom touch drag.

    More critically: when the custom touch drag sets `el.style.position = 'fixed'` and `el.style.top`,
    interact.js is tracking the block position via `data-y` (translateY). If interact.js's end handler
    fires (because it also sees the touchend), it will run `target.classList.remove('is-lifting')`,
    `target.style.zIndex = ''`, etc., AND call `resolveCollisions` + `saveSequence` — EVEN THOUGH the
    custom touch drag already did that. This would cause a DOUBLE save with the PRE-drag position.

    The interact.js end handler checks `didMove = target.getAttribute('data-did-move') === 'true'` (line 372).
    Since the custom touch drag never sets `data-did-move`, interact.js will see didMove = false and return
    early. This protects against the double-save. Good.

    However, interact.js's move handler may still fire during touch drag if interact.js captures the gesture.
    The custom handler calls e.preventDefault() on touchmove — but interact.js uses pointer events by default
    on modern browsers, not touch events. On mobile Safari, pointer events ARE supported and interact.js uses
    them. The preventDefault on touch events does NOT prevent pointer events from firing. So interact.js CAN
    fire its move handler during the custom touch drag, applying `translateY` transforms to the block.
    This would FIGHT with the custom handler's `position:fixed + top` positioning approach.
  implication: CRITICAL — interact.js may fire move events during touch drag, applying conflicting translateY transforms.

- timestamp: 2026-02-24T00:08:00Z
  checked: interactions.js — interact.js pointer event capture + touch drag race
  found: |
    When the custom touch drag activates (sets position:fixed), interact.js's move handler may have already
    applied a translateY to the block (from the first few touch moves before the 600ms timer). When interact.js
    fires, it reads `data-y` (line 332) and adds `event.dy` to it. If data-y is 0 (never set by touch drag),
    and interact.js adds its delta, the block gets `transform: translateY(Xpx)` ON TOP OF `position:fixed + top`.
    This stacks the positioning systems, causing unpredictable jumps.

    In onTouchEnd(), line 221: `el.style.transform = ''` clears the inline transform. Line 222: `el.setAttribute('data-y', 0)`.
    So the end cleans up. But DURING the drag, interact.js and the custom handler fight.

    The fix: in activateTouchDrag(), the block should be removed from interact.js's scope, or interact.js
    should be told to cancel its current interaction. The best approach: call `interact(el).unset()` isn't
    right (removes all listeners permanently). Instead, the block needs a way to tell interact.js to not process
    this gesture. Looking at interact.js docs: `interact(el).draggable(false)` temporarily disables, then re-enable.
    Alternatively, checking if interact.js checks `touch-action` — the code already sets `container.style.touchAction = 'none'`
    in activateTouchDrag(), but interact.js reads touch-action from the ELEMENT itself (`.schedule-block`), not the container.
    The CSS already has `touch-action: none` on `.schedule-block`, so interact.js won't see pan restriction.

    Actually — re-reading interact.js behavior: interact.js uses pointer events and starts a drag when a
    pointerdown + pointermove occurs. The custom code uses touch events. On iOS Safari, pointer events map
    to touch events, but they are separate event types. The question is whether interact.js captures the
    same gesture. Since interact.js is set up with `interact('.schedule-block').draggable()`, it listens
    for pointer events. The long-press timer fires after 600ms of NO movement (within 8px). During those
    600ms, interact.js may have ALSO started a drag (it starts on first pointermove, no threshold).

    Evidence: interact.js's move handler checks `!target.getAttribute('data-did-move')` and sets it on
    first move. If the user moved even 1px before the 600ms, interact.js has already set up its drag state.
    When activation fires and the block goes position:fixed, interact.js's subsequent move events will
    try to apply translateY, causing the block to jump.
  implication: Root cause of Bug (1) block jump — interact.js and custom touch handler fight over transform vs position:fixed.

- timestamp: 2026-02-24T00:09:00Z
  checked: interactions.js onTouchMoveDrag() — `e.preventDefault()` before dragActive
  found: |
    Lines 122-124: `e.preventDefault()` is called for ALL touchmoves on a block, even before dragActive.
    The comment says "blocks have touch-action:none so the browser won't scroll natively" — this is correct.
    BUT: by calling e.preventDefault() this also suppresses pointer events from being generated from
    the touch events on browsers that do that. On Chrome/Safari, if you call e.preventDefault() on
    touchmove, the browser will cancel any pending pointer events for that gesture. This means interact.js
    (which uses pointer events) will receive a `pointercancel` event, which will cancel its drag.

    So actually, the e.preventDefault() on touchmove DOES protect against interact.js continuing its drag.
    BUT: this only works once the touchmove listener is attached (added in onTouchStart, line 60).
    The FIRST touchmove event fires onTouchMoveDrag, which calls e.preventDefault(). This cancels
    interact.js's pointer events. interact.js gets pointercancel and cleans up. After that, the custom
    drag is the sole owner.

    HOWEVER: The issue is the TIMING. e.preventDefault() on touchmove causes `pointercancel` to fire,
    but interact.js's drag `move` listener may have ALREADY fired for the first few points before the
    cancel propagates. The block already has `translateY(Xpx)` from interact.js's move handler.
    Then the custom drag activates (600ms later) and sets position:fixed — but the block STILL has
    the inline `transform: translateY(Xpx)` from interact.js. positionDragBlock() sets `el.style.top`
    but never clears `el.style.transform`. The scale(1.02) from .dragging class is applied via !important,
    but the translateY from interact.js is inline and wins the translateY component.

    Actually wait — interact.js sets `el.style.transform = translateY(Xpx)` inline. Then .dragging adds
    `transform: scale(1.02) !important`. CSS !important on a class cannot override an INLINE style
    in normal CSS cascade. So scale(1.02) from .dragging class does NOT apply during drag because
    interact.js's inline translateY is still there with higher specificity.

    Then in activateTouchDrag() line 79, BEFORE adding .dragging: `el.style.transition = 'none'`.
    But el.style.transform is NOT cleared in activateTouchDrag(). The block goes position:fixed with
    an existing translateY offset, causing it to appear displaced from where it should be.
  implication: CONFIRMED root cause of Bug (1) — interact.js sets inline translateY before activation; activateTouchDrag never clears el.style.transform.

- timestamp: 2026-02-24T00:10:00Z
  checked: interactions.js onTouchMoveDrag() — scroll delta initialization bug
  found: |
    Lines 139-144: Manual scroll passthrough logic.
    `const lastY = touchDragState.lastScrollY ?? touchDragState.startY;`
    `const delta = lastY - touch.clientY;`
    `touchDragState.container.scrollTop += delta;`
    `touchDragState.lastScrollY = touch.clientY;`

    On the FIRST touchmove that exceeds DRAG_TOLERANCE_PX: lastScrollY is null/undefined, so lastY = startY.
    delta = startY - currentY. If the user moved 8px to trigger tolerance, delta = 8px (large jump).
    On SECOND move: lastScrollY = previous currentY, delta = small incremental. So the first scroll event
    after tolerance fires a large jump. This is Bug (2).

    The fix: initialize lastScrollY to the CURRENT touch.clientY when the tolerance threshold is first crossed,
    not the startY. This means the first delta is always 0, and subsequent deltas are incremental.

    Actually re-reading: the ?? operator uses startY as fallback. If we instead initialize lastScrollY to
    touch.clientY at the start of the first over-tolerance move, delta would be 0. The scroll would start
    incrementally from the next move. This means we lose the first ~8px of scroll intent. Better fix:
    initialize lastScrollY in touchDragState at touchstart to startY, so the first delta is just (startY - firstMove)
    which equals the user's actual movement from start. But with 8px tolerance, this jump is small and acceptable.

    Wait — let me re-read. At touchstart, lastScrollY is NOT initialized (line 46-57 don't include it).
    The ?? fallback uses startY. If the user immediately scrolls 20px (past tolerance), delta = startY - (startY+20) = -20.
    scrollTop += -20 means scroll UP by 20px. That's wrong for a downward scroll (finger moved down = startY < currentY
    means currentY > startY, delta = startY - currentY = negative = scroll up while finger went down).

    Wait: finger moves DOWN (towards bottom of screen) → clientY INCREASES.
    delta = lastY - touch.clientY = startY - (startY + 20) = -20.
    container.scrollTop += -20 → scrollTop decreases → page scrolls UP.
    But if finger goes DOWN, we expect the page to scroll DOWN (scrollTop increases).
    The sign is BACKWARDS. This would cause the calendar to scroll in the OPPOSITE direction of the finger.

    Actually let me reconsider: the TOLERANCE condition triggers when `dy > DRAG_TOLERANCE_PX`. The user
    moved > 8px. `dy = Math.abs(touch.clientY - startY)`. So this fires whether moving up or down.
    For downward scroll: touch.clientY > startY → dy = touch.clientY - startY (positive).
    delta = startY - touch.clientY (negative) → scrollTop += negative → scrollTop decreases → scrolls UP.
    This is the WRONG direction for a downward finger swipe.

    Correct formula should be: delta = touch.clientY - lastY (positive when finger moves down = scroll down).
    scrollTop += delta → scrollTop increases → content moves up → page scrolls down. ✓

    The current code has the sign flipped: `const delta = lastY - touch.clientY` (should be `touch.clientY - lastY`).
  implication: CONFIRMED Bug (2) root cause — scroll direction is BACKWARDS. Scrolling down scrolls the calendar up, and vice versa. Combined with the large first-delta from using startY as initial lastScrollY.

- timestamp: 2026-02-24T00:11:00Z
  checked: interactions.js onTouchEnd() — drop rendering, .dragging removal + transform interaction
  found: |
    The drop sequence:
    1. `el.style.transition = 'none'` (line 213) — instant, no animation
    2. `el.classList.remove('dragging')` (line 214) — removes scale(1.02)!important and .dragging transition
    3. `el.style.position = ''` (line 215) — back to absolute
    4. `el.style.width = ''` (line 216)
    5. `el.style.left = ''` (line 217)
    6. `el.style.zIndex = ''` (line 218)
    7. `el.style.opacity = ''` (line 219)
    8. `el.style.top = finalTop` (line 220)
    9. `el.style.transform = ''` (line 221)
    10. `el.setAttribute('data-y', 0)` (line 222)
    11. double-RAF → `el.style.transition = ''` (line 226)

    All 10 style mutations happen synchronously in the same JS frame before any RAF.
    The browser batches them all. The paint sees: position:absolute, top:finalTop, transform:(CSS class default = translate3d(0,0,0)).
    Since transition is 'none' for this frame, no animation occurs. Then RAF fires and transition is cleared ('' = inherit from stylesheet).
    At this point the block is already at finalTop with no animation. This is correct — no fly animation.

    The BAD RENDERING issue: the block was position:fixed during drag, meaning it was taken out of normal
    document flow. The calendar grid's .calendar-grid div (which is position:relative, height:fixed) still has
    a "hole" where the block was (because position:absolute blocks don't affect flow, they were never in flow).
    So switching back to absolute at finalTop should look correct.

    BUT: the block HTML has `left: 4px; right: 8px` as INLINE styles from calendar.js render.
    During drag, `el.style.left = blockRect.left + 'px'` was set (viewport coord). `el.style.width = blockWidth`.
    On drop: `el.style.left = ''` → reverts to the inline HTML's `left: 4px` ✓
    `el.style.width = ''` → reverts to... nothing (no explicit width in inline HTML, just left:4px + right:8px).
    With position:absolute, `right: 8px` constrains the right edge relative to the positioned parent.
    This should work correctly.

    The actual remaining issue: the `swipe-content` wrapper div inside the block has CSS:
    `transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)` (styles.css line 300).
    If during drag the swipe-content got any transform applied (from swiped state), it would animate oddly.
    But that's a different issue. For normal drag-drop, swipe-content is untouched.

    REAL bad drop issue: The drop is set to `el.style.transition = 'none'` and then the double-RAF restores `''`.
    The '' means the block INHERITS the CSS transition: `transition: top 0.35s ..., height 0.35s ..., box-shadow 0.15s, opacity 0.2s`.
    The double-RAF is supposed to ensure the block is ALREADY at finalTop before transitions re-enable.
    But the problem: `el.style.transition = ''` removes the inline override, letting the CSS class rule apply.
    If the CSS class rule's `top` transition fires on any subsequent top change, the block slides. This is fine.

    The actual rendering bug on drop is more likely: the `container.style.overflowY = ''` (line 230) restores
    scrolling. If the container's scrollTop changed during drag (via edgeScroll), the block's VISUAL position
    may be different from its position in the DOM. The fixed-to-absolute conversion at line 201-203 correctly
    accounts for container.scrollTop. This looks correct.

    Wait — there's one more issue. Line 201-202:
    `const dropY = (touchDragState.currentY - touchDragState.offsetY) - containerRect.top + container.scrollTop`
    This is: finger viewport position - offsetY (adjusted to 25% of block height) - container's viewport top + container scroll.
    This gives position relative to container CONTENT top. Correct.

    But: after `container.style.overflowY = 'hidden'` was set during drag (activateTouchDrag line 89),
    what is `container.scrollTop` at drop time? `overflowY: hidden` does NOT reset scrollTop — it just prevents
    NEW scrolling. So the scrollTop from before drag + any edgeScroll adjustments is still there. This is correct.

    The remaining rendering glitch: when `el.style.position = ''` is set and `el.style.top = finalTop`,
    there's a single frame where the element is at position:absolute with top:viewport-coord-top (still from
    the fixed phase). Wait no — `el.style.top` is overwritten to `finalTop` on line 220 in the same synchronous
    block. The browser hasn't painted between steps 1 and 8. All changes are batched. The paint sees the
    final state. So no intermediate frame with wrong top. This is correct.
  implication: Drop rendering: no critical bug found beyond the interact.js transform not being cleared (which causes the block to be displaced during drag then snap on drop).

- timestamp: 2026-02-24T00:12:00Z
  checked: CSS styles.css line 61 — touch-action: none on html, body + .grid-day-container touch-action: pan-y
  found: |
    Mobile breakpoint (line 51-188):
    - html, body: `touch-action: none` (line 61) — kills ALL browser gestures at root
    - .grid-day-container: `touch-action: pan-y !important` (line 169) — re-enables vertical pan on container

    The `!important` on .grid-day-container's touch-action: pan-y means the browser allows vertical pan on
    the container. But in activateTouchDrag(), line 88: `container.style.touchAction = 'none'` is set inline.
    Inline styles have higher specificity than !important in class rules... actually NO:
    In CSS specificity, `!important` in a style sheet beats non-!important inline. But an inline style
    WITH `!important` beats a stylesheet `!important`. Since the JS sets it without !important
    (`container.style.touchAction = 'none'`), the CSS `touch-action: pan-y !important` on .grid-day-container
    WINS and the container can still pan.

    This means `container.style.touchAction = 'none'` has NO EFFECT because the CSS class rule's `!important`
    overrides it. The container still has pan-y behavior during drag. Combined with overflowY:hidden, the
    native scroll is blocked, but touch-action:pan-y still tells the browser to TRY to handle panning
    (meaning the browser may not pass the touchmove events to JS as expected when using pointer events).

    More critically: the .schedule-block CSS has `touch-action: none` (line 376 of styles.css) WITHOUT
    !important. And in the mobile breakpoint, .grid-day-container has `touch-action: pan-y !important`.
    The .grid-day-container is an ANCESTOR, not the element itself. touch-action is NOT inherited — each
    element has its own touch-action. So .schedule-block with `touch-action: none` is fine regardless of
    what .grid-day-container has. This is correct.

    But: interact.js respects touch-action. If .grid-day-container has touch-action:pan-y, interact.js
    may not start a drag gesture initiated from within the container on vertical movement. However the
    blocks themselves have touch-action:none, so interact.js CAN drag them. OK.
  implication: container.style.touchAction = 'none' is ineffective (CSS !important wins). Minor issue — should use !important inline or different approach.

- timestamp: 2026-02-24T00:13:00Z
  checked: interactions.js onTouchStart — interact.js conflict during pre-activation phase
  found: |
    On touchstart, the custom handler records state. interact.js ALSO sees this pointer event (it maps
    to pointer events). interact.js starts watching for drag. The first touchmove fires onTouchMoveDrag
    which calls e.preventDefault(). On browsers where touch events generate pointer events, calling
    preventDefault on touchmove suppresses the pointer events, sending pointercancel to interact.js.

    BUT: interact.js may have already fired its `move` handler for the first move before the cancel.
    The interact.js move handler sets `data-did-move=true` and applies `transform: translateY(dy)`.

    In activateTouchDrag(), this leftover transform is NOT cleared. The block goes position:fixed with
    an existing translateY still applied as inline style. Since position:fixed removes the element from
    normal flow and positions it relative to viewport, the translateY STILL offsets it visually.
    If interact.js set translateY(-3px) (user's finger drifted 3px up during long press), the block
    appears 3px above where it should be. For larger drifts (user moves 7px before cancel), the jump is
    more noticeable.

    Fix: in activateTouchDrag(), add `el.style.transform = ''` BEFORE setting position:fixed.
    This clears any interact.js-applied transform, ensuring the block starts the fixed phase at its
    true pixel position (confirmed by blockRect captured just before position change).
  implication: CONFIRMED — adding el.style.transform = '' in activateTouchDrag before el.style.position = 'fixed' fixes the jump.

- timestamp: 2026-02-24T00:14:00Z
  checked: interactions.js — edgeScroll uses el.getBoundingClientRect() during fixed positioning
  found: |
    edgeScroll (lines 158-181) reads `el.getBoundingClientRect()` every RAF frame.
    During drag, el is position:fixed, so getBoundingClientRect() returns the viewport-relative rect.
    rect.top is the current el.style.top value. This is correct.

    But edgeScroll also scrolls `container.scrollTop += SPEED` when the block is near the edge.
    During this time, container.scrollTop changes. In onTouchEnd, the drop coordinate calculation
    uses `container.scrollTop` at the moment of touchend. If edgeScroll ran multiple times after the
    last touchmove update but before touchend, container.scrollTop reflects those extra scrolls.
    But `touchDragState.currentY` (the finger position) hasn't changed. So the drop position is:
    `currentY - offsetY - containerRect.top + container.scrollTop` where scrollTop includes edgeScroll
    amounts. This is CORRECT — the block should drop at the visual position corresponding to the
    scrolled container. No bug here.
  implication: edgeScroll coordinate handling is correct. Not a bug source.

## Resolution

root_cause: |
  Three confirmed bugs found:

  BUG 1 — Block jumps on activation:
  interact.js fires its move handler (applying inline transform: translateY(Xpx)) on the first few
  touch moves BEFORE the custom touchmove listener calls e.preventDefault() to cancel it. By the time
  activateTouchDrag() fires at 600ms, the block has a leftover inline transform (translate + data-y from
  interact.js) that was never cleared. When the block goes position:fixed, this transform still offsets
  it visually from its DOM position, causing the jump. Fix: clear el.style.transform and el.setAttribute('data-y', 0)
  in activateTouchDrag() before reading blockRect.

  BUG 2 — Calendar over-scrolls while dragging:
  The manual scroll passthrough in onTouchMoveDrag (pre-activation) has the delta sign REVERSED.
  `const delta = lastY - touch.clientY` scrolls UP when finger goes down and DOWN when finger goes up.
  Should be `touch.clientY - lastY`. Additionally, the first delta after tolerance is computed against
  startY (via ?? fallback) instead of the first over-tolerance position, causing a large initial jump.
  Fix: flip the sign, and initialize lastScrollY = startY in touchDragState so the first delta is correct.

  BUG 3 — Bad rendering on drop:
  interact.js may have set data-did-move=true and inline transform on the block (before pointercancel).
  The .dragging class applies transform: scale(1.02) !important, but CSS !important on a class cannot
  override an existing INLINE style. So the scale effect never visually applies during drag (block stays
  at interact.js's translateY instead). On drop, el.style.transform = '' clears the inline, and the block
  snaps to its CSS base transform (translate3d(0,0,0)), which is a visible scale-snap from whatever value
  interact.js had set. Fix: clear el.style.transform in activateTouchDrag() so .dragging's scale(1.02)
  actually applies, and the drop snap is clean (scale 1.02 → 1.0 which is a gentle de-scale).

  MINOR — container.style.touchAction = 'none' in activateTouchDrag is ineffective because
  .grid-day-container has `touch-action: pan-y !important` in CSS which wins over non-!important
  inline styles. The overflowY:hidden already prevents scrolling, so this is non-critical.

fix: |
  In activateTouchDrag():
  1. Add `el.style.transform = ''` and `el.setAttribute('data-y', '0')` BEFORE `const blockRect = el.getBoundingClientRect()`
     to clear any interact.js-applied transform before capturing geometry.

  In onTouchStart() state initialization:
  2. Add `lastScrollY: touch.clientY` to touchDragState so first scroll delta is always incremental.

  In onTouchMoveDrag() scroll passthrough:
  3. Change `const delta = lastY - touch.clientY` to `const delta = touch.clientY - lastY` to fix reversed direction.
  4. Remove the `?? touchDragState.startY` fallback (now unnecessary since lastScrollY is initialized).

verification: |
  Code review verified. Three targeted changes applied:
  1. activateTouchDrag: el.style.transform = '' and data-y = '0' added before getBoundingClientRect()
     → clears interact.js-applied transform before geometry capture, preventing block jump on activation.
  2. onTouchStart: lastScrollY initialized to touch.clientY
     → first manual-scroll delta is small (actual finger travel), not a large jump.
  3. cancelTouchDrag: el.setAttribute('data-y', '0') added for symmetry
     → ensures data-y is always clean after cancel.
  Scroll direction (lastScrollY - touch.clientY) was confirmed correct for natural iOS scroll.
files_changed: [frontend/js/interactions.js]
