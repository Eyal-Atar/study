/**
 * js/interactions.js
 * Handles Apple-style Drag & Drop, Resizing, and Mobile Touch interactions.
 */

import { authFetch, getAPI } from './store.js?v=14';

const HOUR_HEIGHT = 160; // Match calendar.js scale
const SNAP_MINUTES = 15;
const SNAP_PIXELS = (SNAP_MINUTES / 60) * HOUR_HEIGHT;

// ─── Touch Drag (long-press) ──────────────────────────────────────────────────
// Mouse drag is handled by interact.js. Touch drag uses a custom handler so we
// can distinguish a quick tap (→ edit modal) from a long-press (→ drag).

const LONG_PRESS_MS = 300;
let touchDragState = null; // { el, blockId, container, startY, currentY, timer, edgeRAF }

function initTouchDrag() {
    document.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove',  onTouchMove,  { passive: false });
    document.addEventListener('touchend',   onTouchEnd,   { passive: false });
    document.addEventListener('touchcancel',cancelTouchDrag, { passive: true });
}

function onTouchStart(e) {
    const block = e.target.closest('.schedule-block:not(.block-break):not(.is-completed)');
    // Ignore taps on interactive children (checkbox, delete btn)
    if (!block) return;
    if (e.target.closest('.task-checkbox, .delete-reveal-btn')) return;

    const touch = e.touches[0];
    const container = block.closest('.grid-day-container');
    if (!container) return;

    touchDragState = {
        el: block,
        blockId: block.getAttribute('data-block-id'),
        container,
        startY: touch.clientY,
        currentY: touch.clientY,
        dragActive: false,
        offsetY: touch.clientY - block.getBoundingClientRect().top,
        timer: setTimeout(() => activateTouchDrag(), LONG_PRESS_MS),
        edgeRAF: null,
    };
}

function activateTouchDrag() {
    if (!touchDragState) return;
    const { el } = touchDragState;
    touchDragState.dragActive = true;

    if (navigator.vibrate) navigator.vibrate(50);
    el.classList.add('dragging');
    el.style.position = 'fixed';
    el.style.width = el.getBoundingClientRect().width + 'px';
    el.style.zIndex = '1001';
    positionDragBlock();

    document.body.style.overflow = 'hidden';
    touchDragState.container.style.touchAction = 'none';

    touchDragState.edgeRAF = requestAnimationFrame(edgeScroll);
}

function onTouchMove(e) {
    if (!touchDragState) return;
    const touch = e.touches[0];
    touchDragState.currentY = touch.clientY;

    if (!touchDragState.dragActive) {
        // Cancel long-press if finger moves more than 8px (user is scrolling)
        if (Math.abs(touch.clientY - touchDragState.startY) > 8) {
            cancelTouchDrag();
        }
        return;
    }

    e.preventDefault();
    positionDragBlock();
}

function positionDragBlock() {
    const { el, currentY, offsetY } = touchDragState;
    el.style.top = (currentY - offsetY) + 'px';
}

function edgeScroll() {
    if (!touchDragState?.dragActive) return;
    const { currentY, container } = touchDragState;
    const vh = window.innerHeight;
    const EDGE = vh * 0.10; // top/bottom 10% of viewport
    const SPEED = 6;

    const scrollable = container.closest('.overflow-y-auto, .overflow-auto') || window;
    if (currentY < EDGE) {
        if (scrollable === window) window.scrollBy(0, -SPEED);
        else scrollable.scrollTop -= SPEED;
    } else if (currentY > vh - EDGE) {
        if (scrollable === window) window.scrollBy(0, SPEED);
        else scrollable.scrollTop += SPEED;
    }

    touchDragState.edgeRAF = requestAnimationFrame(edgeScroll);
}

async function onTouchEnd(_e) {
    if (!touchDragState) return;
    clearTimeout(touchDragState.timer);
    cancelAnimationFrame(touchDragState.edgeRAF);

    if (!touchDragState.dragActive) {
        touchDragState = null;
        return;
    }

    const { el, container } = touchDragState;

    // Restore element to grid-relative positioning
    const containerRect = container.getBoundingClientRect();
    const dropY = touchDragState.currentY - touchDragState.offsetY - containerRect.top;
    const snapped = Math.round(dropY / SNAP_PIXELS) * SNAP_PIXELS;
    const finalTop = Math.max(0, snapped);

    el.classList.remove('dragging');
    el.style.position = '';
    el.style.width = '';
    el.style.zIndex = '';
    el.style.top = `${finalTop}px`;
    el.style.transform = '';
    el.setAttribute('data-y', 0);

    document.body.style.overflow = '';
    container.style.touchAction = '';

    // Resolve collisions + save
    const allBlocks = Array.from(container.querySelectorAll('.schedule-block')).map(b => ({
        id: b.getAttribute('data-block-id'),
        top: b === el ? finalTop : parseFloat(b.style.top),
        height: parseFloat(b.style.height),
        el: b,
    }));
    const resolved = resolveCollisions(allBlocks, touchDragState.blockId);
    const startHour = parseInt(container.dataset.startHour || 0);
    const gridEndPixel = (24 - startHour) * HOUR_HEIGHT;
    const updates = resolved.map(b => ({
        blockId: b.id,
        top: b.top,
        height: b.height,
        isDelayed: b.top + b.height > gridEndPixel,
    }));
    resolved.forEach(b => { b.el.style.top = `${b.top}px`; b.el.style.transform = ''; });

    touchDragState = null;
    await saveSequence(updates, container);
}

function cancelTouchDrag() {
    if (!touchDragState) return;
    clearTimeout(touchDragState.timer);
    if (touchDragState.edgeRAF) cancelAnimationFrame(touchDragState.edgeRAF);
    if (touchDragState.dragActive) {
        const { el, container } = touchDragState;
        el.classList.remove('dragging');
        el.style.position = '';
        el.style.width = '';
        el.style.zIndex = '';
        document.body.style.overflow = '';
        container.style.touchAction = '';
    }
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
                        interact.snappers.grid({ y: SNAP_PIXELS })
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
                        const gridEndPixel = (24 - startHour) * HOUR_HEIGHT;
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
                    targets: [ interact.snappers.grid({ y: SNAP_PIXELS }) ]
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
                        const gridEndPixel = (24 - startHour) * HOUR_HEIGHT;
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
    const timeLabel = target.querySelector('.text-base.font-bold.text-white');
    if (!timeLabel) return;

    const container = target.closest('.grid-day-container');
    const startHour = parseInt(container?.dataset.startHour || 0);

    const startTotalMin = Math.round((currentTop / HOUR_HEIGHT) * 60) + (startHour * 60);
    const h = Math.floor(startTotalMin / 60);
    const m = startTotalMin % 60;
    
    timeLabel.textContent = `${h}:${String(m).padStart(2, '0')}`;
}

async function saveSequence(blocks, container) {
    const API = getAPI();
    const dayDate = container.getAttribute('data-day-date');
    const startHour = parseInt(container.getAttribute('data-start-hour') || 0);
    
    const updates = blocks.filter(b => b.blockId).map(b => {
        const startMin = Math.round((b.top / HOUR_HEIGHT) * 60) + (startHour * 60);
        const durationMin = Math.round((b.height / HOUR_HEIGHT) * 60);
        
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
        
        // Use a small delay to let the UI settle before refreshing
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('calendar-needs-refresh'));
        }, 100);
    } catch (e) {
        console.error("Failed to save sequence:", e);
    }
}
