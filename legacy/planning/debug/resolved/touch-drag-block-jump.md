---
status: resolved
trigger: "touch-drag-block-jump — On long-press drag of schedule blocks, the block sometimes jumps far from the finger, disappears, then reappears — multiple conflicting commands seem to be fighting each other."
created: 2026-02-25T00:00:00Z
updated: 2026-02-25T00:02:00Z
---

## Current Focus

hypothesis: RESOLVED
test: N/A
expecting: N/A
next_action: N/A

## Symptoms

expected: Block should follow the finger smoothly during drag. It should stay visually under the finger at all times, and drop exactly where the finger lifts.
actual: The block jumps far away from the finger during drag. It sometimes disappears entirely then reappears. The final drop position is correct. The problem is in the live drag tracking — multiple commands appear to conflict.
errors: No JS errors reported. Visual/behavioral glitch only.
reproduction: Long-press a schedule block on mobile (touch), start dragging. The block should follow finger but instead jumps around unpredictably. Release finger — drop position is correct.
started: Ongoing. Previous fix attempts: "fix(drag): defer position:fixed switch to next RAF", "debug: stop momentum scroll + strip positionDragBlock to bare viewport math", "fix(drag): lock body overflow BEFORE capturing blockRect", "debug: strip all drag animations to isolate jump cause", "fix(drag): remove CSS transition:top from .schedule-block"

## Eliminated

- hypothesis: CSS transition animating top during position:fixed switch
  evidence: transition:none is set inline and .schedule-block base rule has no top transition; .dragging CSS is bare
  timestamp: 2026-02-25T00:00:30Z

- hypothesis: incorrect scrollTop accounting during edgeScroll
  evidence: edgeScroll only moves container, does not write block.style.top; drop coordinate math correctly adds container.scrollTop
  timestamp: 2026-02-25T00:00:30Z

- hypothesis: interact.js fighting touch drag
  evidence: interact.js is guarded by pointer:fine media query and skipped entirely on touch devices
  timestamp: 2026-02-25T00:00:30Z

## Evidence

- timestamp: 2026-02-25T00:00:45Z
  checked: activateTouchDrag() execution flow
  found: |
    touchDragState.dragActive is set to true on line 70 SYNCHRONOUSLY.
    Then body overflow is locked and container.touchAction is set SYNCHRONOUSLY.
    Then requestAnimationFrame(RAF-A) is queued to do the actual position:fixed switch.
    During the one-frame gap between dragActive=true and RAF-A executing, the
    element still has position:absolute. Any touchmove in that window calls
    positionDragBlock() which sets el.style.top in VIEWPORT coordinates on a
    position:absolute element, sending the block far from its actual grid position.
    RAF-A then fires and sets position:fixed + correct top — producing the jump-back.
  implication: The activation path has a 1-frame window where dragActive=true but position is still absolute, causing coordinate space mismatch.

- timestamp: 2026-02-25T00:00:50Z
  checked: positionDragBlock() implementation
  found: |
    Every touchmove event calls positionDragBlock() which calls requestAnimationFrame().
    At 60-120Hz, multiple touchmove events fire per rendered frame.
    Each queues its own RAF callback. Multiple RAF callbacks then execute in the
    same frame, each writing el.style.top. The last one wins but intermediate
    writes can trigger intermediate paints on some browser versions, causing jitter.
    More critically: if touchmove fires 3x before the frame commits, 3 RAF callbacks
    are queued. Each reads touchDragState.currentY — which was updated by each
    touchmove event. The intermediate values create stale writes that fight
    the final correct value.
  implication: positionDragBlock should use a single persistent RAF loop, not one RAF per event.

- timestamp: 2026-02-25T00:00:55Z
  checked: The offsetY recalculation inside the activation RAF
  found: |
    Line 130: touchDragState.offsetY = touchDragState.currentY - lockedRect.top
    This is correct — it re-anchors offsetY to the block's stable fixed position.
    HOWEVER: between activateTouchDrag() running (which sets touchDragState.offsetY
    on line 98) and RAF-A running, positionDragBlock() uses the OLD offsetY.
    That old offsetY was calculated against position:absolute coordinates.
    Any positionDragBlock() call during this gap uses wrong offsetY + wrong position
    type simultaneously.
  implication: Both offsetY and position type are wrong during the 1-frame gap.

- timestamp: 2026-02-25T00:01:00Z
  checked: onTouchEnd drop calculation
  found: |
    Drop coordinate math is correct: uses currentY - offsetY to get viewport top,
    then subtracts containerRect.top and adds container.scrollTop to convert to
    container-relative. This matches what position:absolute top needs.
    This is why the final drop position is always correct.
  implication: Only the live-drag tracking is broken; drop logic is fine.

## Resolution

root_cause: |
  Two compounding bugs in interactions.js positionDragBlock() / activateTouchDrag():

  BUG 1 — ACTIVATION GAP COORDINATE MISMATCH (primary cause of the jump):
  activateTouchDrag() sets touchDragState.dragActive = true synchronously, but defers
  the actual el.style.position = 'fixed' switch to the next requestAnimationFrame.
  During that one-frame gap (~8-16ms), any touchmove event fires onTouchMoveDrag()
  which sees dragActive=true and calls positionDragBlock(). positionDragBlock() then
  writes `el.style.top = (currentY - offsetY) + 'px'` — VIEWPORT coordinates — to an
  element that is still position:absolute (container-relative coordinates). If the
  container has scrolled even 100px, the block flies 100px to the wrong place visually.
  One frame later, the activation RAF fires, applies position:fixed, and snaps the block
  back to the correct position. This produces the visible jump-disappear-reappear cycle.
  The drop coordinate is correct because onTouchEnd is called AFTER the activation RAF
  completes, so position:fixed is always live by then.

  BUG 2 — MULTIPLE RAF ACCUMULATION (cause of jitter during drag):
  Every touchmove event called positionDragBlock() → requestAnimationFrame(callback).
  At 120Hz, up to 2 touchmove events fire per 16ms frame, each queuing its own RAF.
  The RAF scheduler batches them and executes both in the same frame tick. Each RAF
  read potentially stale values from state (currentY captured at different moments)
  and wrote conflicting top values, causing visible jitter as the block oscillated
  between two positions within a single frame.

fix: |
  Added two flags to touchDragState:

  1. fixedActive (boolean, default false):
     Set to true INSIDE the activation RAF, immediately after el.style.position = 'fixed'
     is written. positionDragBlock() returns early if fixedActive is false. This
     eliminates all writes during the activation gap — no viewport coords ever reach
     a position:absolute element.

  2. rafPending (boolean, default false):
     Set to true when a RAF is scheduled; reset to false at the top of the RAF callback.
     positionDragBlock() returns early if rafPending is true. Only one RAF is ever
     inflight. It reads the most recent currentY from state when it executes, so it
     always uses the latest finger position — no stale accumulated writes.

verification: |
  Code trace verified:
  - During activation gap (dragActive=true, fixedActive=false): positionDragBlock() returns
    immediately on the fixedActive guard. No writes to el.style.top occur.
  - After activation RAF: fixedActive=true. positionDragBlock() proceeds normally.
    Only one RAF ever inflight due to rafPending guard — always reads latest currentY.
  - Drop: onTouchEnd coordinate math unchanged. Still correct (adds container.scrollTop).
  Syntax check: node --check passed with no errors.

files_changed:
  - frontend/js/interactions.js
