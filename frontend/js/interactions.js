/**
 * js/interactions.js
 * Handles Apple-style Drag & Drop, Resizing, and Mobile Touch interactions.
 */

import { authFetch, getAPI } from './store.js?v=31';

// HOUR_HEIGHT must match calendar.js render scale (responsive)
function getHourHeight() { return window.innerWidth < 768 ? 70 : 160; }
const SNAP_MINUTES = 15;
function getSnapPixels() { return (SNAP_MINUTES / 60) * getHourHeight(); }

// ─── Touch Drag (long-press) ──────────────────────────────────────────────────
// Gesture rules:
//   • Normal touch+scroll  → native scroll, no JS interference
//   • Long press (350ms, still within 5px) → drag mode
//   • Double-tap on block  → edit modal (handled in calendar.js via touchend timing)
//
// Key: touchstart is PASSIVE (never blocks scroll).
// A non-passive touchmove is added ONLY when a block is touched, and removed
// the moment the gesture ends or the user starts scrolling. This means the
// browser only has to wait for JS on moves that may become a drag, not every
// scroll on the page.

const LONG_PRESS_MS = 600;
const DRAG_TOLERANCE_PX = 8; // px of movement allowed before drag is cancelled
let touchDragState = null; // { el, blockId, container, startX, startY, currentY, timer, edgeRAF, dragActive, offsetY, lastScrollY }

function initTouchDrag() {
    // PASSIVE touchstart — never blocks scroll, just records the hit
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    // touchmove is NOT registered globally — added/removed per-gesture in onTouchStart/cancelTouchDrag
    document.addEventListener('touchend',    onTouchEnd,    { passive: true });
    document.addEventListener('touchcancel', cancelTouchDrag, { passive: true });
}

function onTouchStart(e) {
    const block = e.target.closest('.schedule-block:not(.block-break):not(.is-completed)');
    if (!block) return;
    if (e.target.closest('.task-checkbox, .delete-reveal-btn')) return;

    const touch = e.touches[0];
    const container = block.closest('.grid-day-container');
    if (!container) return;

    touchDragState = {
        el: block,
        blockId: block.getAttribute('data-block-id'),
        container,
        startX: touch.clientX,
        startY: touch.clientY,
        currentY: touch.clientY,
        dragActive: false,
        offsetY: touch.clientY - block.getBoundingClientRect().top,
        // Initialize lastScrollY to startY so the first manual-scroll delta is correct
        // (touch.clientY - lastScrollY will be the actual finger movement, not a large jump
        // from startY to some far position).
        lastScrollY: touch.clientY,
        timer: setTimeout(() => activateTouchDrag(), LONG_PRESS_MS),
        edgeRAF: null,
    };

    // Start long-press charge animation immediately
    block.classList.add('long-pressing');

    // Add non-passive touchmove ONLY for this gesture — scoped, not global
    document.addEventListener('touchmove', onTouchMoveDrag, { passive: false });
}

function activateTouchDrag() {
    if (!touchDragState) return;
    const { el } = touchDragState;
    touchDragState.dragActive = true;

    if (navigator.vibrate) navigator.vibrate(40);

    // Clear any stale transform (e.g. from a prior swipe gesture).
    el.style.transform = '';
    el.setAttribute('data-y', '0');

    // Recalculate offsetY using the block's CURRENT viewport position.
    // During the 600ms long-press window the container may have scrolled, so
    // the touchstart offsetY is stale.
    const blockRect = el.getBoundingClientRect();
    touchDragState.offsetY = touchDragState.currentY - blockRect.top;

    // Remove any in-progress repositioning animation.
    el.classList.remove('block-repositioning');

    // Stop iOS momentum scroll and lock body scroll.
    const container = touchDragState.container;
    container.scrollTop = container.scrollTop; // stops -webkit-overflow-scrolling momentum
    document.body.style.overflow = 'hidden';
    container.style.touchAction = 'none';

    // Switch from long-press animation to active drag visual.
    el.classList.remove('long-pressing');
    el.style.transition = 'none';
    el.classList.add('dragging');
    el.style.opacity = '0.92';

    // Position block immediately under the finger.
    positionDragBlock();

    touchDragState.edgeRAF = requestAnimationFrame(edgeScroll);
}

function onTouchMoveDrag(e) {
    if (!touchDragState) {
        document.removeEventListener('touchmove', onTouchMoveDrag);
        return;
    }

    const touch = e.touches[0];
    touchDragState.currentY = touch.clientY;

    if (!touchDragState.dragActive) {
        // Before long-press activates: let native scroll (pan-y) handle scrolling.
        // Only cancel the timer if the user moves — they intend to scroll, not drag.
        const dx = Math.abs(touch.clientX - touchDragState.startX);
        const dy = Math.abs(touch.clientY - touchDragState.startY);

        if (dy > DRAG_TOLERANCE_PX || dx > DRAG_TOLERANCE_PX) {
            if (touchDragState.timer) {
                clearTimeout(touchDragState.timer);
                touchDragState.timer = null;
            }
            // Remove our listener entirely — native scroll takes over.
            document.removeEventListener('touchmove', onTouchMoveDrag);
        }
        return;
    }

    // Drag is active — block native scroll and reposition the dragged block.
    e.preventDefault();
    positionDragBlock();
}

function positionDragBlock() {
    if (!touchDragState?.dragActive) return;
    const { el, container, currentY, offsetY } = touchDragState;
    // Block stays position:absolute — top is relative to container scroll content.
    // Convert finger viewport Y → absolute content Y:
    //   absolute_top = (fingerViewportY - offsetY) - containerViewportTop + containerScrollTop
    const containerRect = container.getBoundingClientRect();
    const newTop = Math.max(0, (currentY - offsetY) - containerRect.top + container.scrollTop);
    el.style.top = newTop + 'px';
    updateLiveTimeLabel(el, newTop);
}

function edgeScroll() {
    if (!touchDragState?.dragActive) return;
    const { container } = touchDragState;
    const MARGIN_TOP = 160;  // px from top edge that triggers scroll-up
    const MARGIN_BOT = 120;  // px from bottom edge that triggers scroll-down
    const SPEED = 10;  // px per frame

    const y = touchDragState.currentY;

    if (y < MARGIN_TOP) {
        container.scrollBy({ top: -SPEED, behavior: 'auto' });
        positionDragBlock(); // keep block under finger as container scrolls
    } else if (y > window.innerHeight - MARGIN_BOT) {
        container.scrollBy({ top: SPEED, behavior: 'auto' });
        positionDragBlock(); // keep block under finger as container scrolls
    }

    touchDragState.edgeRAF = requestAnimationFrame(edgeScroll);
}

async function onTouchEnd(_e) {
    if (!touchDragState) return;
    clearTimeout(touchDragState.timer);
    cancelAnimationFrame(touchDragState.edgeRAF);
    document.removeEventListener('touchmove', onTouchMoveDrag);

    if (!touchDragState.dragActive) {
        // Finger lifted before long-press completed — cancel the charge animation
        touchDragState.el.classList.remove('long-pressing');
        touchDragState = null;
        return;
    }

    const { el, container } = touchDragState;

    // Compute final drop position: same formula as positionDragBlock(), then snap.
    const containerRect = container.getBoundingClientRect();
    const dropY = (touchDragState.currentY - touchDragState.offsetY)
                  - containerRect.top
                  + container.scrollTop;
    const snapPx = getSnapPixels();
    const snapped = Math.round(dropY / snapPx) * snapPx;
    const finalTop = Math.max(0, snapped);

    el.style.transition = 'none';
    el.classList.remove('dragging');
    el.style.zIndex = '';
    el.style.opacity = '';
    el.style.top = `${finalTop}px`;
    el.style.transform = '';
    el.setAttribute('data-y', 0);
    // Double RAF ensures layout recalculates before transitions re-enable.
    requestAnimationFrame(() => requestAnimationFrame(() => { el.style.transition = ''; }));

    document.body.style.overflow = '';
    container.style.touchAction = '';
    container.style.overflowY = '';

    // Resolve collisions + save
    const allBlocks = Array.from(container.querySelectorAll('.schedule-block')).map(b => ({
        id: b.getAttribute('data-block-id'),
        top: b === el ? finalTop : parseFloat(b.style.top),
        height: parseFloat(b.style.height),
        el: b,
    }));
    const resolved = resolveCollisions(allBlocks, touchDragState.blockId);
    const startHour = parseInt(container.dataset.startHour || 0);
    const gridEndPixel = (24 - startHour) * getHourHeight();
    const updates = resolved.map(b => ({
        blockId: b.id,
        top: b.top,
        height: b.height,
        isDelayed: b.top + b.height > gridEndPixel,
    }));
    resolved.forEach(b => {
        b.el.style.top = `${b.top}px`;
        b.el.style.transform = '';
        updateLiveTimeLabel(b.el, b.top);
    });

    touchDragState = null;
    await saveSequence(updates, container);
}

function cancelTouchDrag() {
    if (!touchDragState) return;
    clearTimeout(touchDragState.timer);
    if (touchDragState.edgeRAF) cancelAnimationFrame(touchDragState.edgeRAF);
    const { el } = touchDragState;
    el.classList.remove('long-pressing'); // always clear, whether drag was active or not
    if (touchDragState.dragActive) {
        const { container } = touchDragState;
        el.style.transition = 'none';
        el.classList.remove('dragging');
        el.style.zIndex = '';
        el.style.opacity = '';
        el.style.transform = '';
        el.setAttribute('data-y', '0');
        requestAnimationFrame(() => { el.style.transition = ''; });
        document.body.style.overflow = '';
        container.style.touchAction = '';
        container.style.overflowY = '';
    }
    // Always remove the scoped per-gesture listener
    document.removeEventListener('touchmove', onTouchMoveDrag);
    touchDragState = null;
}
// ─────────────────────────────────────────────────────────────────────────────

export function initInteractions() {
    if (!window.interact) return;
    initTouchDrag();

    // interact.js handles mouse-only drag (desktop).
    // Touch drag is handled entirely by initTouchDrag above.
    //
    // CRITICAL: interact.js sets `touch-action: none` on every matched element
    // at setup time — before any drag gesture starts. This CSS property is what
    // tells the browser "don't scroll when the user touches this element", which
    // is exactly what breaks native scroll on touch devices. Stopping it in the
    // `start` handler is too late — the CSS is already applied.
    //
    // `(hover: hover) and (pointer: fine)` matches devices that have a real mouse
    // (precise pointer + true hover). Touch-only phones/tablets match
    // `(hover: none) and (pointer: coarse)` and skip interact.js entirely.
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    // Only interactive for non-break and non-done blocks.
    // ignoreFrom prevents interact.js from intercepting pointer events on
    // interactive child elements (checkboxes, delete buttons), which would
    // otherwise cause interact.js's drag end handler to run on every click
    // and its resolveCollisions call to shift adjacent blocks before the
    // native click fires — resulting in two different blocks receiving click
    // events from a single user interaction.
    interact('.schedule-block:not(.block-break):not(.is-completed)')
        .draggable({
            inertia: true,
            // Include descendant selector (*) so SVG/path children of interactive
            // elements are also ignored — without this, clicking a checked task's
            // SVG checkmark bypasses ignoreFrom and interact.js captures the pointer,
            // causing resolveCollisions to shift blocks before the native click fires.
            ignoreFrom: '.task-checkbox, .task-checkbox *, .delete-reveal-btn, .delete-reveal-btn *',
            modifiers: [
                interact.modifiers.restrictRect({
                    restriction: '.calendar-grid',
                    endOnly: true
                }),
                interact.modifiers.snap({
                    // Use a function target so getSnapPixels() is re-evaluated on
                    // every snap calculation, picking up any responsive HOUR_HEIGHT
                    // changes (e.g. if the user rotates the device or resizes the
                    // window between initInteractions() and the actual drag).
                    // x is set to a very large value (10 000 px) which effectively
                    // disables horizontal snapping; without this the snap modifier
                    // tries to snap X to the nearest multiple of the grid step,
                    // causing horizontal jitter as the block fights its CSS left/right
                    // inline styles that pin it to the column boundaries.
                    targets: [
                        (x, y) => ({ x, y: Math.round(y / getSnapPixels()) * getSnapPixels() })
                    ],
                    range: Infinity,
                    relativePoints: [ { x: 0, y: 0 } ]
                })
            ],
            listeners: {
                start(_event) {
                    // Intentionally empty — all lifting effects deferred to first move.
                    // Mutating the DOM here (zIndex, classList) changes painting order
                    // BEFORE the native click fires, which can cause the click to land
                    // on a different element than the one the user tapped.
                    // Note: only reachable on mouse (pointer: fine) devices — touch
                    // devices return early before interact.js is set up (see above).
                },
                move(event) {
                    const target = event.target;
                    // Apply lifting effect on the FIRST pixel of movement only.
                    // This keeps DOM clean on zero-movement taps.
                    if (!target.getAttribute('data-did-move')) {
                        target.classList.add('is-lifting');
                        target.style.zIndex = '1000';
                        target.style.boxShadow = '0 20px 25px -5px rgb(0 0 0 / 0.3)';
                        target.setAttribute('data-did-move', 'true');
                    }
                    const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;
                    target.style.transform = `translateY(${y}px)`;
                    target.setAttribute('data-y', y);
                    target.style.opacity = '0.8';

                    const currentTop = parseFloat(target.style.top) + y;
                    updateLiveTimeLabel(target, currentTop);

                    // Real-time collision preview
                    const container = target.closest('.grid-day-container');
                    if (container) {
                        const allBlocks = Array.from(container.querySelectorAll('.schedule-block'))
                            .map(el => {
                                return {
                                    id: el.getAttribute('data-block-id'),
                                    top: el === target ? currentTop : parseFloat(el.style.top),
                                    height: parseFloat(el.style.height),
                                    el: el
                                };
                            });

                        const resolved = resolveCollisions(allBlocks, target.getAttribute('data-block-id'));
                        resolved.forEach(b => {
                            if (b.id !== target.getAttribute('data-block-id')) {
                                b.el.style.transform = `translateY(${b.top - parseFloat(b.el.style.top)}px)`;
                            }
                        });
                    }
                },
                async end(event) {
                    const target = event.target;
                    target.classList.remove('is-lifting');
                    target.style.zIndex = '';
                    target.style.opacity = '';
                    target.style.boxShadow = '';

                    // Only save if the block actually moved. Checking data-did-move
                    // (set in the move handler) is more reliable than data-drag-started
                    // (set in start) because start fires even on zero-movement taps
                    // when the pointer lands on non-ignored descendants like SVG children.
                    const didMove = target.getAttribute('data-did-move') === 'true';
                    target.removeAttribute('data-did-move');
                    if (!didMove) return;

                    const container = target.closest('.grid-day-container');
                    if (!container) return;
                    const startHour = parseInt(container.dataset.startHour || 0);

                    const allBlocks = Array.from(container.querySelectorAll('.schedule-block'))
                        .map(el => {
                            const y = el === target ? (parseFloat(el.getAttribute('data-y')) || 0) : (parseFloat(el.style.transform.replace('translateY(', '').replace('px)', '')) || 0);
                            return {
                                blockId: el.getAttribute('data-block-id'),
                                top: parseFloat(el.style.top) + y,
                                height: parseFloat(el.style.height),
                                el: el
                            };
                        });

                    const resolved = resolveCollisions(allBlocks.map(b => ({ ...b, id: b.blockId })), target.getAttribute('data-block-id'));

                    const updates = resolved.map(b => {
                        const gridEndPixel = (24 - startHour) * getHourHeight();
                        return {
                            blockId: b.id,
                            top: b.top,
                            height: b.height,
                            isDelayed: b.top + b.height > gridEndPixel
                        };
                    });

                    // Apply new positions to DOM immediately
                    resolved.forEach(b => {
                        b.el.style.top = `${b.top}px`;
                        b.el.style.transform = '';
                        b.el.setAttribute('data-y', 0);
                        updateLiveTimeLabel(b.el, b.top);
                    });

                    await saveSequence(updates, container);
                }
            }
        })
        // Resize disabled — causes layout conflicts with touch drag.
        // Block duration is edited via the settings/edit modal instead.
        ;
}

function resolveCollisions(blocks, movedBlockId) {
    blocks.sort((a, b) => {
        if (a.top !== b.top) return a.top - b.top;
        if (a.id === movedBlockId) return -1;
        if (b.id === movedBlockId) return 1;
        return 0;
    });

    const GAP = 8;

    for (let i = 0; i < blocks.length; i++) {
        if (i === 0) continue;
        const prev = blocks[i - 1];
        const curr = blocks[i];
        if (curr.top < prev.top + prev.height + GAP) {
            curr.top = prev.top + prev.height + GAP;
        }
    }
    return blocks;
}

function updateLiveTimeLabel(target, currentTop) {
    const timeLabel = target.querySelector('.block-time-label');
    if (!timeLabel) return;

    const container = target.closest('.grid-day-container');
    const startHour = parseInt(container?.dataset.startHour || 0);

    const startTotalMin = Math.round((currentTop / getHourHeight()) * 60) + (startHour * 60);
    const h = Math.floor(startTotalMin / 60);
    const m = startTotalMin % 60;
    
    timeLabel.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

async function saveSequence(blocks, container) {
    const API = getAPI();
    const dayDate = container.getAttribute('data-day-date');
    const startHour = parseInt(container.getAttribute('data-start-hour') || 0);
    
    const updates = blocks.filter(b => b.blockId).map(b => {
        const hh = getHourHeight();
        const startMin = Math.round((b.top / hh) * 60) + (startHour * 60);
        const durationMin = Math.round((b.height / hh) * 60);
        
        const startH = Math.floor(startMin / 60);
        const startM = startMin % 60;
        
        const localStartDate = new Date(dayDate + 'T' + String(startH).padStart(2, '0') + ':' + String(startM).padStart(2, '0') + ':00');
        const localEndDate = new Date(localStartDate.getTime() + durationMin * 60000);
        
        const toLocalISO = (date) => new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 19);

        return {
            blockId: b.blockId,
            start_time: toLocalISO(localStartDate),
            end_time: toLocalISO(localEndDate),
            is_delayed: b.isDelayed
        };
    });

    if (updates.length === 0) return;

    try {
        await Promise.all(updates.map(u =>
            authFetch(`${API}/tasks/block/${u.blockId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    start_time: u.start_time,
                    end_time: u.end_time,
                    is_delayed: u.is_delayed
                })
            })
        ));
        // Pass updated times directly so calendar.js can update _blocksByDay
        // immediately — no server re-fetch needed before opening edit modal.
        window.dispatchEvent(new CustomEvent('sf:blocks-saved', {
            detail: { dayDate, updates }
        }));
    } catch (e) {
        console.error("Failed to save sequence:", e);
    }
}
