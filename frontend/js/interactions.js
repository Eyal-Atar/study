/**
 * js/interactions.js
 * Handles Apple-style Drag & Drop, Resizing, and Mobile Touch interactions.
 */

import { authFetch, getAPI } from './store.js?v=21';

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
        timer: setTimeout(() => activateTouchDrag(), LONG_PRESS_MS),
        edgeRAF: null,
    };

    // Add non-passive touchmove ONLY for this gesture — scoped, not global
    document.addEventListener('touchmove', onTouchMoveDrag, { passive: false });
}

function activateTouchDrag() {
    if (!touchDragState) return;
    const { el } = touchDragState;
    touchDragState.dragActive = true;

    if (navigator.vibrate) navigator.vibrate(15);

    // Capture block width BEFORE switching to fixed (parent constrains width)
    const blockWidth = el.getBoundingClientRect().width;

    // Disable the 'top' CSS transition BEFORE changing position.
    // Without this, the transition sees the old container-relative top value
    // animating to the new viewport-relative top value — causing the block to "fly".
    // Only keep transform/shadow/opacity transitions for the drag-lift effect.
    el.style.transition = 'transform 0.12s ease, box-shadow 0.12s ease, opacity 0.2s';

    el.classList.add('dragging');
    el.style.position = 'fixed';
    el.style.width = blockWidth + 'px';
    el.style.zIndex = '1001';
    positionDragBlock();

    document.body.style.overflow = 'hidden';
    touchDragState.container.style.touchAction = 'none';

    touchDragState.edgeRAF = requestAnimationFrame(edgeScroll);
}

function onTouchMoveDrag(e) {
    if (!touchDragState) {
        document.removeEventListener('touchmove', onTouchMoveDrag);
        return;
    }

    const touch = e.touches[0];
    touchDragState.currentY = touch.clientY;

    // Always preventDefault: blocks have touch-action:none so the browser won't
    // scroll natively regardless, but this ensures no fallthrough to ancestors.
    e.preventDefault();

    if (!touchDragState.dragActive) {
        const dx = Math.abs(touch.clientX - touchDragState.startX);
        const dy = Math.abs(touch.clientY - touchDragState.startY);

        if (dy > DRAG_TOLERANCE_PX || dx > DRAG_TOLERANCE_PX) {
            // User intends to scroll, not drag — cancel the long-press timer
            // and manually pass the scroll delta to the container so the calendar
            // moves normally even though touch-action:none suppresses native scroll.
            if (touchDragState.timer) {
                clearTimeout(touchDragState.timer);
                touchDragState.timer = null;
            }

            if (dy >= dx) { // Primarily vertical → scroll the calendar
                const lastY = touchDragState.lastScrollY ?? touchDragState.startY;
                const delta = lastY - touch.clientY; // positive = scroll down
                touchDragState.container.scrollTop += delta;
            }
            touchDragState.lastScrollY = touch.clientY;
        }
        return;
    }

    // Drag is active — reposition the dragged block
    positionDragBlock();
}

function positionDragBlock() {
    const { el, currentY, offsetY } = touchDragState;
    el.style.top = (currentY - offsetY) + 'px';
}

function edgeScroll() {
    if (!touchDragState?.dragActive) return;
    const { el, container } = touchDragState;
    const vh = window.innerHeight;
    // Only 8px from the actual screen edge — scroll starts when the BLOCK EDGE
    // touches the screen edge, not when the finger is in some broad zone.
    const MARGIN = 8;
    const SPEED = 5;

    const rect = el.getBoundingClientRect();
    const scrollable = container.scrollHeight > container.clientHeight ? container : window;

    if (rect.top < MARGIN) {
        // Block's top edge is at/above the screen top
        if (scrollable === window) window.scrollBy(0, -SPEED);
        else scrollable.scrollTop -= SPEED;
    } else if (rect.bottom > vh - MARGIN) {
        // Block's bottom edge is at/below the screen bottom
        if (scrollable === window) window.scrollBy(0, SPEED);
        else scrollable.scrollTop += SPEED;
    }

    touchDragState.edgeRAF = requestAnimationFrame(edgeScroll);
}

async function onTouchEnd(_e) {
    if (!touchDragState) return;
    clearTimeout(touchDragState.timer);
    cancelAnimationFrame(touchDragState.edgeRAF);
    document.removeEventListener('touchmove', onTouchMoveDrag);

    if (!touchDragState.dragActive) {
        touchDragState = null;
        return;
    }

    const { el, container } = touchDragState;

    // Convert fixed-position drop coordinates → container-content-relative position.
    // Must add container.scrollTop: position:absolute top is relative to content origin,
    // not the visible viewport top. Without this, dragging while edgeScroll has scrolled
    // the container places the block at the wrong (too-high) position.
    const containerRect = container.getBoundingClientRect();
    const dropY = (touchDragState.currentY - touchDragState.offsetY)
                  - containerRect.top
                  + container.scrollTop;
    const snapPx = getSnapPixels();
    const snapped = Math.round(dropY / snapPx) * snapPx;
    const finalTop = Math.max(0, snapped);

    // Disable ALL transitions before switching position:fixed → position:absolute.
    // The CSS 'top' transition would otherwise animate from the viewport-coord value
    // to the container-coord value, making the block visually "fly" across the screen.
    el.style.transition = 'none';
    el.classList.remove('dragging');
    el.style.position = '';
    el.style.width = '';
    el.style.zIndex = '';
    el.style.top = `${finalTop}px`;
    el.style.transform = '';
    el.setAttribute('data-y', 0);
    // Re-enable transitions after the position change has been painted
    requestAnimationFrame(() => { el.style.transition = ''; });

    document.body.style.overflow = '';
    container.style.touchAction = ''; // restore to CSS default (pan-y from stylesheet)

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
    if (touchDragState.dragActive) {
        const { el, container } = touchDragState;
        el.style.transition = 'none';
        el.classList.remove('dragging');
        el.style.position = '';
        el.style.width = '';
        el.style.zIndex = '';
        el.style.transform = '';
        requestAnimationFrame(() => { el.style.transition = ''; });
        document.body.style.overflow = '';
        container.style.touchAction = '';
    }
    // Always remove the scoped per-gesture listener
    document.removeEventListener('touchmove', onTouchMoveDrag);
    touchDragState = null;
}
// ─────────────────────────────────────────────────────────────────────────────

export function initInteractions() {
    if (!window.interact) return;
    initTouchDrag();

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
                    targets: [
                        interact.snappers.grid({ y: getSnapPixels() })
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
        .resizable({
            edges: { bottom: true },
            ignoreFrom: '.task-checkbox, .task-checkbox *, .delete-reveal-btn, .delete-reveal-btn *',
            modifiers: [
                interact.modifiers.snap({
                    targets: [ interact.snappers.grid({ y: getSnapPixels() }) ]
                }),
                interact.modifiers.restrictSize({
                    min: { height: 30 }
                })
            ],
            listeners: {
                move(event) {
                    const target = event.target;
                    let { height } = event.rect;
                    target.style.height = `${height}px`;
                    target.style.opacity = '0.8';

                    const currentTop = parseFloat(target.style.top) + (parseFloat(target.getAttribute('data-y')) || 0);
                    updateLiveTimeLabel(target, currentTop);

                    // Real-time collision preview
                    const container = target.closest('.grid-day-container');
                    if (container) {
                        const allBlocks = Array.from(container.querySelectorAll('.schedule-block'))
                            .map(el => {
                                return {
                                    id: el.getAttribute('data-block-id'),
                                    top: parseFloat(el.style.top),
                                    height: el === target ? height : parseFloat(el.style.height),
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
                    target.style.opacity = '';
                    const container = target.closest('.grid-day-container');
                    if (!container) return;
                    const startHour = parseInt(container.dataset.startHour || 0);

                    const allBlocks = Array.from(container.querySelectorAll('.schedule-block'))
                        .map(el => {
                            const y = (parseFloat(el.style.transform.replace('translateY(', '').replace('px)', '')) || 0);
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
        });
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
        // Notify calendar.js to silently refresh _blocksByDay so navigation
        // doesn't revert blocks to their pre-drag positions.
        window.dispatchEvent(new CustomEvent('sf:blocks-saved'));
    } catch (e) {
        console.error("Failed to save sequence:", e);
    }
}
