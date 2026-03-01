import { getCurrentExams, getCurrentTasks, getAPI, authFetch, getCurrentSchedule, setCurrentSchedule, getCurrentUser, getTodayStr } from './store.js?v=AUTO';
import { examColorClass, showTaskEditModal, showConfirmModal, examHex } from './ui.js?v=AUTO';
import { initInteractions } from './interactions.js?v=AUTO';

let currentDayIndex = 0;
let dayKeys = [];
// Track active time indicator interval to prevent leaks on re-render
let _timeIndicatorInterval = null;

export function renderExamLegend() {
    const el = document.getElementById('exam-legend');
    if (!el) return;
    const currentExams = getCurrentExams();
    if (currentExams.length === 0) {
        el.innerHTML = '<p class="text-white/30 text-sm">Add exams to see legend</p>';
        return;
    }
    el.innerHTML = currentExams.map((exam, i) => `
        <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full ${examColorClass(i,'bg')}"></div>
            <span class="text-sm text-white/60">${exam.name}</span>
        </div>
    `).join('');
}

// Module-level blocksByDay reference so handleDeleteBlock can do optimistic local updates
let _blocksByDay = {};

// State for swipe interactions (double-tap is handled by interactions.js)
let _touchStartX = 0;
let _touchStartY = 0;

function getGridParams() {
    return {
        startHour: 0,
        hourHeight: window.innerWidth < 768 ? 70 : 160
    };
}

/**
 * Renders the study calendar.
 */
export function renderCalendar(tasks, schedule = [], forceScrollToWake = false) {
    try {
        const container = document.getElementById('roadmap-container');
        if (!container) return;

        // Re-init interactions after any render to ensure fresh elements are picked up if needed
        // although document-level listeners usually handle this, it's safer for state consistency.
        initInteractions();

        // Capture scroll position before re-render
        const gridContainer = container.querySelector('.grid-day-container');
        const oldScrollTop = (gridContainer && !forceScrollToWake) ? gridContainer.scrollTop : null;

        if (!tasks || tasks.length === 0) {
            const hasExams = (getCurrentExams() || []).length > 0;
            const user = getCurrentUser();
            const userName = user ? (user.name || 'Student') : 'Student';
            
            container.innerHTML = `
                <div class="absolute left-[15px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-accent-500 via-mint-400 to-gold-400 opacity-20"></div>
                <div class="text-center py-12 px-6">
                    <div class="text-5xl mb-4">🧠</div>
                    <h3 class="text-xl font-bold mb-2">Hey ${userName}, ${hasExams ? 'Exams are ready!' : 'Ready to start?'}</h3>
                    <p class="text-white/40 text-sm mb-8">
                        ${hasExams 
                            ? 'Your exams are in! Now let the AI build your perfect study schedule.' 
                            : 'Add your first exam to build your personalized study roadmap.'}
                    </p>
                    ${hasExams ? `
                        <button id="btn-generate-roadmap-empty" class="bg-gradient-to-r from-accent-500 to-mint-500 hover:opacity-90 text-white font-bold py-3 px-8 rounded-2xl transition-all active:scale-95 shadow-lg shadow-accent-500/25">
                            🚀 Generate My Roadmap
                        </button>
                    ` : `
                        <button id="btn-add-exam-empty" class="bg-accent-500 hover:bg-accent-600 text-white font-bold py-3 px-8 rounded-2xl transition-all active:scale-95 shadow-lg shadow-accent-500/20">
                            + Add My First Exam
                        </button>
                    `}
                </div>`;
            
            const addBtn = document.getElementById('btn-add-exam-empty');
            if (addBtn) addBtn.onclick = () => window.dispatchEvent(new CustomEvent('open-add-exam'));

            const genBtn = document.getElementById('btn-generate-roadmap-empty');
            if (genBtn) genBtn.onclick = () => window.dispatchEvent(new CustomEvent('trigger-generate-roadmap'));
            
            return;
        }

        const today = getTodayStr();

        if (schedule && schedule.length > 0) {
            const blocksByDay = {};
            let minDate = today;
            let maxDate = today;

            schedule.forEach(block => {
                if (!block.day_date) return;
                if (!blocksByDay[block.day_date]) blocksByDay[block.day_date] = [];
                blocksByDay[block.day_date].push(block);
                
                if (block.day_date < minDate) minDate = block.day_date;
                if (block.day_date > maxDate) maxDate = block.day_date;
            });

            // FILL GAPS: Ensure dayKeys is a continuous sequence from minDate to maxDate
            const keys = [];
            const [minY, minM, minD] = minDate.split('-').map(Number);
            const [maxY, maxM, maxD] = maxDate.split('-').map(Number);
            
            let curr = new Date(minY, minM - 1, minD);
            const last = new Date(maxY, maxM - 1, maxD);
            
            while (curr <= last) {
                const y = curr.getFullYear();
                const m = String(curr.getMonth() + 1).padStart(2, '0');
                const d = String(curr.getDate()).padStart(2, '0');
                keys.push(`${y}-${m}-${d}`);
                curr.setDate(curr.getDate() + 1);
            }
            dayKeys = keys;
            _blocksByDay = blocksByDay;

            console.log(`[CALENDAR] Initialized with ${dayKeys.length} days. Range: ${minDate} to ${maxDate}`);

            const savedDay = localStorage.getItem('sf_selected_day');
            if (savedDay && dayKeys.includes(savedDay)) {
                currentDayIndex = dayKeys.indexOf(savedDay);
            } else if (dayKeys.includes(today)) {
                currentDayIndex = dayKeys.indexOf(today);
            } else {
                currentDayIndex = 0;
            }

            renderHourlyGrid(container, tasks, _blocksByDay, forceScrollToWake);

            // Restore scroll position after re-render if we were on the same day
            if (oldScrollTop !== null) {
                const newGridContainer = container.querySelector('.grid-day-container');
                if (newGridContainer) newGridContainer.scrollTop = oldScrollTop;
            }
        } else {
            dayKeys = [today];
            _blocksByDay = { [today]: [] };
            currentDayIndex = 0;
            renderHourlyGrid(container, tasks, _blocksByDay, forceScrollToWake);
        }
    } catch (err) {
        console.error('CRITICAL: renderCalendar failed:', err);
        const container = document.getElementById('roadmap-container');
        if (container) {
            container.innerHTML = '<div class="text-center py-12 text-red-400/50"><p>Something went wrong rendering the calendar.</p></div>';
        }
    }
}

function renderDayPicker(container, tasks, blocksByDay) {
    const day = dayKeys[currentDayIndex];
    const date = new Date(day + 'T00:00:00');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const dayNum = date.getDate();
    const monthName = date.toLocaleDateString('en-US', { month: 'long' });
    const today = getTodayStr();
    const isToday = day === today;

    const navHtml = `
        <div class="flex items-center justify-between mb-3 md:mb-6 bg-dark-800/40 p-2 md:p-3 rounded-2xl border border-white/5">
            <button id="btn-prev-day" class="w-9 h-9 md:w-10 md:h-10 flex items-center justify-center rounded-xl bg-dark-700 hover:bg-accent-500/20 text-white/60 hover:text-accent-400 transition-all ${currentDayIndex === 0 ? 'opacity-20 cursor-not-allowed' : ''}" ${currentDayIndex === 0 ? 'disabled' : ''}>
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
            </button>
            <div class="text-center">
                <div class="flex items-center justify-center gap-2">
                    <span class="text-sm font-bold ${isToday ? 'text-accent-400' : 'text-white/90'}">${isToday ? 'TODAY' : dayName.toUpperCase()}</span>
                    ${isToday ? '<span class="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse"></span>' : ''}
                </div>
                <div class="text-[11px] text-white/30 uppercase tracking-widest">${monthName} ${dayNum}</div>
            </div>
            <button id="btn-next-day" class="w-10 h-10 flex items-center justify-center rounded-xl bg-dark-700 hover:bg-accent-500/20 text-white/60 hover:text-accent-400 transition-all ${currentDayIndex === dayKeys.length - 1 ? 'opacity-20 cursor-not-allowed' : ''}" ${currentDayIndex === dayKeys.length - 1 ? 'disabled' : ''}>
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </button>
        </div>
    `;

    return navHtml;
}

function renderHourlyGrid(container, tasks, blocksByDay, forceScrollToWake = false) {
    try {
        const day = dayKeys[currentDayIndex];
        if (!day) {
            renderCalendar(tasks, []);
            return;
        }

        const dayBlocks = (blocksByDay[day] || [])
            .filter(b => b.block_type !== 'break')
            .sort((a,b) => a.start_time.localeCompare(b.start_time));
            
        const currentExams = getCurrentExams();
        const examIdx = {};
        currentExams.forEach((e, i) => { examIdx[e.id] = i; });

        const parseLocalDate = (dateStr) => {
            if (!dateStr) return null;
            const isoStr = dateStr.replace(' ', 'T');
            return new Date(isoStr);
        };

        const formatLocalTime = (date) => {
            if (!date || isNaN(date)) return '';
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        };

        const { startHour, hourHeight } = getGridParams();

        let html = renderDayPicker(container, tasks, blocksByDay);

        const renderedBlocks = dayBlocks.map((block) => {
            const start = parseLocalDate(block.start_time);
            const end = parseLocalDate(block.end_time);
            if (!start || !end || isNaN(start) || isNaN(end)) return '';
            
            const startH = start.getHours();
            const startM = start.getMinutes();

            const durationMin = Math.round(Math.abs(end - start) / 60000);
            const visualTop = ((startH + startM / 60) - startHour) * hourHeight;
            const visualHeight = (durationMin / 60) * hourHeight;

            const eIdx = block.exam_id !== null && block.exam_id !== -1 ? (examIdx[block.exam_id] ?? -1) : -1;
            const typeClass = `block-${block.block_type}`;
            const startTimeStr = formatLocalTime(start);
            const endTimeStr = formatLocalTime(end);
            const isDone = block.completed === 1;
            const completedClass = isDone ? 'is-completed' : '';

            const title = block.task_title || '';
            const isPadding = title.startsWith('General Review:') || title.startsWith('Solve Practice Problems:');
            const isHobby = block.block_type === 'hobby';
            const paddingClass = isPadding ? 'block-padding' : '';

            const BLOCK_BG_COLORS = [
                'rgba(107,71,245,0.18)', 'rgba(16,185,129,0.18)', 'rgba(244,63,94,0.18)', 'rgba(245,158,11,0.18)', 'rgba(56,189,248,0.18)',
            ];
            
            let blockBg;
            let borderColor;
            
            if (isHobby) {
                blockBg = 'repeating-linear-gradient(45deg, rgba(56,189,248,0.05), rgba(56,189,248,0.05) 10px, rgba(56,189,248,0.15) 10px, rgba(56,189,248,0.15) 20px)';
                borderColor = '#38BDF8';
            } else {
                blockBg = eIdx !== -1 ? BLOCK_BG_COLORS[eIdx % BLOCK_BG_COLORS.length] : BLOCK_BG_COLORS[0];
                borderColor = eIdx !== -1 ? examHex(eIdx) : '#6B47F5';
            }

            const timeRangeStr = visualHeight >= 50 ? `${startTimeStr} – ${endTimeStr}` : startTimeStr;

            let displayTitle = (block.part_number && block.total_parts && block.total_parts > 1)
                ? `${block.task_title} (Part ${block.part_number}/${block.total_parts})`
                : block.task_title;
            
            if (isHobby) displayTitle = `🧘 ${displayTitle}`;

            const badgeHtml = isHobby && visualHeight >= 36 
                ? '<span class="hobby-badge">Hobby</span> '
                : (isPadding && visualHeight >= 36 ? '<span class="padding-badge">Review</span> ' : '');

            return `
                <div class="schedule-block ${typeClass} ${completedClass} ${paddingClass} ${block.is_delayed ? 'block-delayed' : ''} group"
                     style="position: absolute; top: ${visualTop}px; height: ${visualHeight}px; left: 4px; right: 8px; border-left: 4px solid ${borderColor}; background: ${blockBg}; border-radius: 10px;"
                     data-task-id="${block.task_id || ''}"
                     data-block-id="${block.id || ''}"
                     data-block-type="${block.block_type}"
                     data-is-done="${isDone}">

                    <div class="swipe-content h-full" style="padding: ${visualHeight < 36 ? '2px 6px' : '6px 8px'};">
                        <div class="flex items-start gap-1.5 h-full">
                            <button data-task-id="${block.task_id}" data-block-id="${block.id}"
                                    class="task-checkbox flex-shrink-0 w-5 h-5 mt-0.5 rounded-md border-2 flex items-center justify-center transition-all ${isDone ? 'checked border-mint-500' : 'border-white/20 hover:border-accent-400'}"
                                    style="${isDone ? 'background-color:#10B981;border-color:#10B981;' : ''}">
                                ${isDone ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
                            </button>

                            <div class="flex-1 min-w-0 flex flex-col justify-start h-full overflow-hidden">
                                <div class="font-semibold text-[11px] md:text-[12px] text-white/95 task-title-text leading-tight" dir="auto" style="-webkit-line-clamp:${visualHeight < 50 ? 1 : 2};">${badgeHtml}${displayTitle}</div>
                                ${visualHeight >= 26 ? `<div class="flex items-center gap-1 mt-0.5">
                                    <span class="text-[11px] font-semibold text-white/70 block-time-label tabular-nums">${timeRangeStr}</span>
                                    ${block.is_delayed ? '<span class="delayed-badge" style="font-size:7px;padding:1px 3px;">LATE</span>' : ''}
                                </div>` : ''}
                            </div>
                        </div>
                    </div>
                    <div class="delete-reveal-btn">DELETE</div>
                </div>
            `;
        });

        const totalGridHeight = (24 - startHour) * hourHeight;

        html += `
            <div class="grid-day-container fade-in h-full flex-1 overflow-y-auto"
                 data-day-date="${day}"
                 data-start-hour="${startHour}">
                <div id="calendar-grid-wrapper" class="calendar-grid-wrapper" style="min-height: ${totalGridHeight + 32}px; padding-bottom: 32px;">
                    <div style="display: flex; min-height: ${totalGridHeight}px;">
                        <div class="time-col" style="width: 48px; min-width: 48px; flex-shrink: 0; position: relative; height: ${totalGridHeight}px;">
                            ${Array.from({length: 24 - startHour}).map((_, i) => {
                                const h = i + startHour;
                                return `<div class="hour-label" style="top: ${i * hourHeight}px;">${String(h).padStart(2, '0')}:00</div>`;
                            }).join('')}
                        </div>
                        <div class="calendar-grid" style="flex: 1; position: relative; height: ${totalGridHeight}px; border-left: 1px solid rgba(255,255,255,0.06);">
                            ${Array.from({length: 24 - startHour}).map((_, i) => {
                                return `<div style="position: absolute; top: ${i * hourHeight}px; left: 0; right: 0; height: 1px; background: rgba(255,255,255,0.06); pointer-events: none;"></div>`;
                            }).join('')}
                            ${renderedBlocks.join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        const gridContainer = container.querySelector('.grid-day-container');
        if (gridContainer) {
            const user = getCurrentUser();
            const wakeHour = user?.wake_up_time ? parseInt(user.wake_up_time.split(':')[0], 10) : 7;
            let earliestBlockHour = 24;
            dayBlocks.forEach(b => {
                const d = parseLocalDate(b.start_time);
                if (d && !isNaN(d)) {
                    const h = d.getHours();
                    if (h < earliestBlockHour) earliestBlockHour = h;
                }
            });
            const scrollHour = Math.min(wakeHour, earliestBlockHour);

            if (!container.dataset.renderedOnce) {
                setTimeout(() => { gridContainer.scrollTop = scrollHour * hourHeight; }, 150);
                container.dataset.renderedOnce = 'true';
            } else if (forceScrollToWake) {
                gridContainer.scrollTop = scrollHour * hourHeight;
            }
        }

        renderCurrentTimeIndicator(container, startHour, hourHeight);
        setupGridListeners(container);

    } catch (err) {
        console.error('renderHourlyGrid failed:', err);
    }
}

async function refreshScheduleOnly() {
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/schedule`);
        if (!res.ok) return;
        const newSchedule = await res.json();
        setCurrentSchedule(newSchedule);
        renderCalendar(getCurrentTasks(), newSchedule);
        renderFocus(getCurrentTasks());
    } catch (err) { console.error('Schedule refresh failed:', err); }
}

// Tracks block IDs currently being deleted to prevent concurrent duplicate deletes
const _deletingBlocks = new Set();

async function handleDeleteBlock(blockId, blockType, container) {
    const API = getAPI();
    const executeDelete = async () => {
        // Guard: prevent concurrent deletes of the same block
        if (_deletingBlocks.has(String(blockId))) {
            console.warn(`[DELETE] Block ${blockId} is already being deleted, ignoring duplicate`);
            return;
        }
        _deletingBlocks.add(String(blockId));

        // Capture the block element BEFORE any async operations or re-renders
        const blockEl = container.querySelector(`.schedule-block[data-block-id="${blockId}"]`);

        // Optimistic: animate out and update local state immediately
        if (blockEl) {
            blockEl.style.pointerEvents = 'none';
            blockEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
            blockEl.style.opacity = '0';
            blockEl.style.transform = 'scale(0.95)';
            // Remove after animation completes; use a stable reference via ID attribute
            setTimeout(() => {
                // Re-query in case DOM was rebuilt — harmless if not found
                const el = container.querySelector(`.schedule-block[data-block-id="${blockId}"]`);
                if (el) el.remove();
            }, 220);
        }

        // Optimistic local state update
        const day = dayKeys[currentDayIndex];
        if (_blocksByDay[day]) {
            _blocksByDay[day] = _blocksByDay[day].filter(b => String(b.id) !== String(blockId));
        }
        // Also remove from store so renderFocus is immediately correct
        const storedSchedule = getCurrentSchedule() || [];
        setCurrentSchedule(storedSchedule.filter(b => String(b.id) !== String(blockId)));

        try {
            const res = await authFetch(`${API}/tasks/block/${blockId}`, { method: 'DELETE' });
            if (!res.ok) {
                // DELETE failed — restore state by re-fetching from server
                console.error(`[DELETE] Block ${blockId} delete failed with HTTP ${res.status}`);
                _deletingBlocks.delete(String(blockId));
                await refreshScheduleOnly();
                return;
            }
            // Delete succeeded — local state is already correct.
            // Only re-render Focus (which reads from store) to sync task checkboxes.
            // Skip full refreshScheduleOnly to avoid a redundant round-trip and re-render race.
            renderFocus(getCurrentTasks());
        } catch (err) {
            console.error('[DELETE] Delete network error:', err);
            _deletingBlocks.delete(String(blockId));
            await refreshScheduleOnly();
            return;
        }

        _deletingBlocks.delete(String(blockId));
    };

    if (blockType === 'hobby') {
        showConfirmModal({ title: "Are you sure?", msg: "Your brain cells might miss this break!", icon: "🧘", okText: "Delete anyway", onConfirm: executeDelete });
    } else {
        showConfirmModal({ title: "Delete this block?", msg: "This will remove the scheduled time for this task.", icon: "🗑", okText: "Delete", onConfirm: executeDelete });
    }
}

async function handleSaveBlock(blockId, updates, container) {
    const API = getAPI();
    try {
        const day = dayKeys[currentDayIndex];
        const block = (_blocksByDay[day] || []).find(b => b.id == blockId);
        if (!block) return;
        const { startHour, hourHeight } = getGridParams();
        const dayDate = block.day_date;
        const startDate = new Date(`${dayDate}T${updates.startTimeStr}:00`);
        const endDate = new Date(startDate.getTime() + updates.duration * 60000);

        const blockEl = container.querySelector(`.schedule-block[data-block-id="${blockId}"]`);
        if (blockEl) {
            const newVisualTop = ((startDate.getHours() + startDate.getMinutes() / 60) - startHour) * hourHeight;
            const newVisualHeight = (updates.duration / 60) * hourHeight;
            const titleEl = blockEl.querySelector('.task-title-text');
            if (titleEl && updates.title) titleEl.textContent = updates.title;
            const timeEl = blockEl.querySelector('.block-time-label');
            if (timeEl) {
                const pad = n => String(n).padStart(2,'0');
                const sh = pad(startDate.getHours()), sm = pad(startDate.getMinutes());
                const eh = pad(endDate.getHours()), em = pad(endDate.getMinutes());
                timeEl.textContent = newVisualHeight >= 50 ? `${sh}:${sm} – ${eh}:${em}` : `${sh}:${sm}`;
            }
            blockEl.classList.add('block-repositioning');
            blockEl.style.top = `${newVisualTop}px`;
            blockEl.style.height = `${newVisualHeight}px`;
            setTimeout(() => blockEl.classList.remove('block-repositioning'), 400);
        }

        const toLocalISO = (date) => new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 19);
        await authFetch(`${API}/tasks/block/${blockId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_title: updates.title, start_time: toLocalISO(startDate), end_time: toLocalISO(endDate) })
        });
        await refreshScheduleOnly(container);
    } catch (err) { console.error('Update failed:', err); }
}

// Stable named handler references stored on the container so that
// removeEventListener can find them on re-renders without accumulating duplicates.
// We store them directly on the container element object so each container
// (there is only ever one: #roadmap-container) keeps its own pair.

function _makeTouchStartHandler() {
    return (e) => {
        _touchStartX = e.changedTouches[0].screenX;
        _touchStartY = e.changedTouches[0].screenY;
    };
}

function _makeTouchEndHandler(container) {
    // Double-tap is handled by interactions.js (unified touch state machine).
    // This handler only detects horizontal swipe for day navigation.
    return (e) => {
        if (e.target.closest('.task-checkbox, .delete-reveal-btn')) return;

        const touch = e.changedTouches[0];
        const diffX = touch.screenX - _touchStartX;
        const diffY = touch.screenY - _touchStartY;

        if (Math.abs(diffX) > 60 && Math.abs(diffY) < 40) {
            if (diffX > 0 && currentDayIndex > 0) {
                currentDayIndex--;
                localStorage.setItem('sf_selected_day', dayKeys[currentDayIndex]);
                renderHourlyGrid(container, getCurrentTasks(), _blocksByDay, true);
            } else if (diffX < 0 && currentDayIndex < dayKeys.length - 1) {
                currentDayIndex++;
                localStorage.setItem('sf_selected_day', dayKeys[currentDayIndex]);
                renderHourlyGrid(container, getCurrentTasks(), _blocksByDay, true);
            }
        }
    };
}

function setupGridListeners(container) {
    // onclick is an assignment — safe to re-assign on every render (last writer wins,
    // no accumulation). This ensures the handler is always fresh after roadmap regen.
    container.onclick = (e) => {
        const delBtn = e.target.closest('.delete-reveal-btn');
        if (delBtn) {
            e.stopPropagation();
            const blockEl = delBtn.closest('.schedule-block');
            handleDeleteBlock(blockEl.dataset.blockId, blockEl.dataset.blockType, container);
            return;
        }

        const prevBtn = e.target.closest('#btn-prev-day');
        if (prevBtn && currentDayIndex > 0) {
            currentDayIndex--;
            localStorage.setItem('sf_selected_day', dayKeys[currentDayIndex]);
            renderHourlyGrid(container, getCurrentTasks(), _blocksByDay, true);
            return;
        }

        const nextBtn = e.target.closest('#btn-next-day');
        if (nextBtn && currentDayIndex < dayKeys.length - 1) {
            currentDayIndex++;
            localStorage.setItem('sf_selected_day', dayKeys[currentDayIndex]);
            renderHourlyGrid(container, getCurrentTasks(), _blocksByDay, true);
            return;
        }

        const checkbox = e.target.closest('.task-checkbox');
        if (checkbox) {
            e.stopPropagation();
            const taskId = checkbox.dataset.taskId ? parseInt(checkbox.dataset.taskId) : null;
            const blockId = parseInt(checkbox.dataset.blockId);
            if (!isNaN(blockId)) {
                window.dispatchEvent(new CustomEvent('task-toggle', { detail: { taskId, blockId, btn: checkbox } }));
            }
        }
    };

    container.oncontextmenu = (e) => { e.preventDefault(); };

    // Desktop: double-click on a block opens the edit modal.
    // Touch devices use the double-tap handler in interactions.js instead.
    container.ondblclick = (e) => {
        const blockEl = e.target.closest('.schedule-block:not(.block-break):not(.is-completed)');
        if (!blockEl) return;
        if (e.target.closest('.task-checkbox, .delete-reveal-btn')) return;
        const blockId = blockEl.dataset.blockId;
        if (blockId) {
            window.dispatchEvent(new CustomEvent('sf:edit-block', {
                detail: { blockId, el: blockEl }
            }));
        }
    };

    // For addEventListener-based listeners, remove the previous named handler before
    // adding a new one. This prevents duplicate listeners accumulating across renders
    // while ensuring the handler is always present after roadmap regen.
    if (container._sfTouchStart) {
        container.removeEventListener('touchstart', container._sfTouchStart);
    }
    if (container._sfTouchEnd) {
        container.removeEventListener('touchend', container._sfTouchEnd);
    }

    container._sfTouchStart = _makeTouchStartHandler();
    container._sfTouchEnd = _makeTouchEndHandler(container);

    container.addEventListener('touchstart', container._sfTouchStart, { passive: true });
    container.addEventListener('touchend', container._sfTouchEnd, { passive: true });
}

let _focusMode = 'today'; // 'today' or 'overall'

export function renderFocus(tasks) {
    const today = getTodayStr();

    // Inject virtual tasks for schedule blocks without a task_id (practice, padding)
    const schedule = getCurrentSchedule() || [];
    const virtualTasks = schedule
        .filter(b => !b.task_id && (b.block_type === 'study' || b.block_type === 'hobby'))
        .map(b => {
            const s = new Date(b.start_time.replace(' ', 'T').replace(/Z$/, ''));
            const e = new Date(b.end_time.replace(' ', 'T').replace(/Z$/, ''));
            let hrs = Math.round(Math.abs(e - s) / 3600000 * 10) / 10;
            if (isNaN(hrs) || hrs <= 0) hrs = 0.5;
            return {
                id: `vb-${b.id}`,
                _blockId: b.id,
                is_standalone: true,
                title: b.task_title || b.title || b.subject || 'General Practice',
                exam_id: b.exam_id,
                day_date: b.day_date,
                status: b.completed === 1 ? 'done' : 'pending',
                estimated_hours: hrs,
                _virtual: true,
            };
        });

    const allTasks = [...tasks, ...virtualTasks];
    const sortedTasks = allTasks.sort((a, b) => {
        if (a.day_date !== b.day_date) return (a.day_date || '').localeCompare(b.day_date || '');
        return (a.title || '').localeCompare(b.title || '');
    });

    const displayTasks = _focusMode === 'today' ? sortedTasks.filter(t => t.day_date === today) : sortedTasks;

    let html;
    if (!displayTasks.length) {
        html = `<p class="text-white/30 text-sm">No tasks for ${_focusMode === 'today' ? 'today' : 'now'}</p>`;
    } else {
        const currentExams = getCurrentExams();
        const examIdx = {};
        currentExams.forEach((e, i) => { examIdx[e.id] = i; });
        let lastDate = null;

        html = displayTasks.map(t => {
            const eIdx = examIdx[t.exam_id] ?? 0;
            const isDone = t.status === 'done';
            let dateHeader = '';
            if (_focusMode === 'overall' && t.day_date !== lastDate) {
                let label = 'Unscheduled';
                if (t.day_date) {
                    const date = new Date(t.day_date + 'T00:00:00');
                    label = t.day_date === today ? 'Today' : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                }
                dateHeader = `<div class="text-[10px] font-bold text-white/20 uppercase tracking-widest mt-4 mb-2 ml-1">${label}</div>`;
                lastDate = t.day_date;
            }

            return `${dateHeader}<div class="flex items-center gap-2 bg-dark-900/40 rounded-lg p-2.5 ${isDone ? 'opacity-60' : ''}">
                <button type="button" data-task-id="${t.id}" ${t._blockId ? `data-block-id="${t._blockId}"` : ''} class="focus-task-checkbox flex-shrink-0 w-6 h-6 rounded-full border-2 ${isDone ? 'bg-mint-500 border-mint-500' : 'border-white/20 hover:border-accent-400'} flex items-center justify-center transition-all">
                    ${isDone ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
                </button>
                <div class="w-2.5 h-2.5 rounded-full ${examColorClass(eIdx,'bg')} flex-shrink-0"></div>
                <div class="flex-1 text-sm truncate ${isDone ? 'line-through text-white/50' : ''}" dir="auto">${t.title}</div>
                <div class="text-xs text-white/30">${t.estimated_hours || 0}h</div>
            </div>`;
        }).join('');
    }

    const desktop = document.getElementById('today-tasks');
    if (desktop) desktop.innerHTML = html;
    const drawer = document.getElementById('today-tasks-drawer');
    if (drawer) drawer.innerHTML = html;

    const attachFocusCheckboxes = (container) => {
        if (!container) return;
        container.querySelectorAll('.focus-task-checkbox').forEach(btn => {
            btn.onclick = () => {
                const blockIdAttr = btn.dataset.blockId;
                if (blockIdAttr) {
                    const blockId = parseInt(blockIdAttr, 10);
                    window.dispatchEvent(new CustomEvent('task-toggle', { detail: { taskId: null, btn, blockId } }));
                } else {
                    const taskId = parseInt(btn.dataset.taskId, 10);
                    window.dispatchEvent(new CustomEvent('task-toggle', { detail: { taskId, btn, blockId: undefined } }));
                }
            };
        });
    };
    attachFocusCheckboxes(desktop);
    attachFocusCheckboxes(drawer);

    document.querySelectorAll('.btn-focus-toggle').forEach(btn => {
        const mode = btn.dataset.mode;
        const isActive = mode === _focusMode;
        btn.classList.toggle('bg-accent-500', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('text-white/40', !isActive);
        btn.onclick = (e) => {
            e.preventDefault();
            if (_focusMode === mode) return;
            _focusMode = mode;
            renderFocus(getCurrentTasks());
        };
    });
}

function renderDailyList(container, tasks) {
    const currentExams = getCurrentExams();
    const examIdx = {};
    currentExams.forEach((e, i) => { examIdx[e.id] = i; });

    const days = {};
    tasks.forEach(task => {
        const day = task.day_date || task.deadline || 'unscheduled';
        if (!days[day]) days[day] = [];
        days[day].push(task);
    });
    Object.values(days).forEach(arr => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));

    const dayKeysAll = Object.keys(days).filter(d => d !== 'unscheduled').sort();
    const today = getTodayStr();
    const examDateSet = {};
    currentExams.forEach((e, i) => { examDateSet[e.exam_date] = { name: e.name, idx: i }; });

    let html = '<div class="absolute left-[15px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-accent-500 via-mint-400 to-gold-400 opacity-20"></div>';
    
    if (days['unscheduled']) {
        html += `<div class="fade-in relative mb-8">
            <div class="absolute -left-8 top-1 w-[14px] h-[14px] rounded-full border-2 border-white/10 bg-dark-700"></div>
            <div class="flex items-center gap-2 mb-3">
                <span class="text-sm font-bold text-white/50 uppercase tracking-widest">Unscheduled Tasks</span>
                <span class="text-[10px] bg-accent-500/20 text-accent-400 px-1.5 py-0.5 rounded font-bold">AI GENERATED</span>
            </div>
            <div class="space-y-1.5 ml-1">`;
        
        days['unscheduled'].forEach(task => {
            const eIdx = examIdx[task.exam_id] ?? 0;
            const isDone = task.status === 'done';
            html += `
            <div class="card-hover bg-dark-600/60 rounded-xl p-3 border border-white/5 flex items-center gap-3 ${isDone ? 'opacity-40' : ''}">
                <button data-task-id="${task.id}" class="task-checkbox flex-shrink-0 w-6 h-6 rounded-full border-2 ${isDone ? 'bg-mint-500 border-mint-500' : 'border-white/20 hover:border-accent-400'} flex items-center justify-center transition-all">
                    ${isDone ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
                </button>
                <div class="w-2.5 h-8 rounded-full ${examColorClass(eIdx,'bg')} flex-shrink-0"></div>
                <div class="flex-1 min-w-0">
                    <div class="font-medium text-sm ${isDone ? 'line-through text-white/40' : ''} truncate">${task.title}</div>
                    <div class="text-[10px] text-white/30 uppercase font-bold tracking-wider mt-0.5">Priority: ${task.priority || 5}</div>
                </div>
            </div>`;
        });
        html += `</div></div>`;
    }

    dayKeysAll.forEach(day => {
        const dayTasks = days[day];
        const isToday = day === today;
        const isPast = day < today;
        const date = new Date(day + 'T00:00:00');
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        const examOnDay = examDateSet[day];
        const isExamDay = dayTasks.some(t => t.title && t.title.startsWith('EXAM DAY'));

        html += `<div class="fade-in relative mb-5 ${isPast ? 'opacity-50' : ''}">
            <div class="absolute -left-8 top-1 w-[14px] h-[14px] rounded-full border-2
                ${isToday ? 'border-accent-400 bg-accent-500 node-pulse' : isPast ? 'border-mint-400/50 bg-mint-500/50' : isExamDay || examOnDay ? 'border-gold-400 bg-gold-500' : 'border-white/20 bg-dark-700'}
            "></div>
            <div class="flex items-center gap-2 mb-2 flex-wrap">
                <span class="text-sm font-bold ${isToday ? 'text-accent-400' : isExamDay || examOnDay ? 'text-gold-400' : 'text-white/50'}">${isToday ? 'TODAY' : dayName}</span>
                <span class="text-xs text-white/30">${monthName} ${dayNum}</span>
            </div>`;

        if (isExamDay || examOnDay) {
            const idx = examOnDay ? examOnDay.idx : (examIdx[dayTasks[0].exam_id] ?? 0);
            const examName = examOnDay ? examOnDay.name : (dayTasks[0].title.replace('EXAM DAY: ', ''));
            html += `<div class="mb-2 px-3 py-2 rounded-xl ${examColorClass(idx,'bg20')} border ${examColorClass(idx,'border')}">
                <span class="text-sm font-bold ${examColorClass(idx,'text')}">EXAM: ${examName}</span>
            </div>`;
        }

        const activities = isExamDay ? dayTasks.filter(t => !t.title.startsWith('EXAM DAY')) : dayTasks;
        if (activities.length > 0) {
            html += '<div class="space-y-1.5 ml-1">';
            activities.forEach(task => {
                const eIdx = examIdx[task.exam_id] ?? 0;
                const isDone = task.status === 'done';
                html += `
                <div class="card-hover bg-dark-600/60 rounded-xl p-3 border border-white/5 flex items-center gap-3 ${isDone ? 'opacity-40' : ''}">
                    <button data-task-id="${task.id}" class="task-checkbox flex-shrink-0 w-6 h-6 rounded-full border-2 ${isDone ? 'bg-mint-500 border-mint-500' : 'border-white/20 hover:border-accent-400'} flex items-center justify-center transition-all">
                        ${isDone ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
                    </button>
                    <div class="w-2.5 h-8 rounded-full ${examColorClass(eIdx,'bg')} flex-shrink-0"></div>
                    <div class="flex-1 min-w-0">
                        <div class="font-medium text-sm ${isDone ? 'line-through text-white/40' : ''} truncate">${task.title}</div>
                    </div>
                </div>`;
            });
            html += '</div>';
        }
        html += '</div>';
    });
    container.innerHTML = html;
    
    container.querySelectorAll('.task-checkbox').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const taskId = parseInt(btn.dataset.taskId);
            if (!isNaN(taskId)) window.dispatchEvent(new CustomEvent('task-toggle', { detail: { taskId, btn } }));
        };
    });
}

function renderCurrentTimeIndicator(container, startHour, hourHeight) {
    if (_timeIndicatorInterval !== null) {
        clearInterval(_timeIndicatorInterval);
        _timeIndicatorInterval = null;
    }

    const updateLine = () => {
        const liveGrid = container.querySelector('.calendar-grid');
        if (!liveGrid) {
            if (_timeIndicatorInterval !== null) {
                clearInterval(_timeIndicatorInterval);
                _timeIndicatorInterval = null;
            }
            return;
        }

        let line = liveGrid.querySelector('.current-time-line');
        if (!line) {
            line = document.createElement('div');
            line.className = 'current-time-line';
            line.innerHTML = '<div class="time-now-label">NOW</div>';
            liveGrid.appendChild(line);
        }

        const now = new Date();
        const h = now.getHours();
        const m = now.getMinutes();
        const totalHours = h + m / 60;
        const top = (totalHours - startHour) * hourHeight;
        line.style.top = `${top}px`;
        
        const day = dayKeys[currentDayIndex];
        const isToday = day === getTodayStr();
        line.style.display = (isToday && h >= startHour && h < 24) ? 'block' : 'none';
    };

    updateLine();
    _timeIndicatorInterval = setInterval(updateLine, 60000);
}

window.addEventListener('sf:blocks-saved', (e) => {
    const { dayDate, updates } = e.detail;
    if (_blocksByDay[dayDate]) {
        updates.forEach(u => {
            const idx = _blocksByDay[dayDate].findIndex(b => String(b.id) === String(u.blockId));
            if (idx !== -1) {
                _blocksByDay[dayDate][idx] = { ..._blocksByDay[dayDate][idx], start_time: u.start_time, end_time: u.end_time };
            }
        });
    }
});

// Edit listener — dispatched from interactions.js on double-tap or long-press, and from calendar.js ondblclick
window.addEventListener('sf:edit-block', (e) => {
    const { blockId, el } = e.detail;
    console.log(`[EDIT] sf:edit-block fired for blockId=${blockId}, dayKeys=${dayKeys.length}, _blocksByDay keys=${Object.keys(_blocksByDay).length}`);

    // Search across ALL days in _blocksByDay, not just the current one
    let block = null;
    let targetDay = null;
    for (const day of dayKeys) {
        const found = (_blocksByDay[day] || []).find(b => String(b.id) === String(blockId));
        if (found) {
            block = found;
            targetDay = day;
            break;
        }
    }

    if (!block) {
        console.warn(`[EDIT] Block ${blockId} not found in _blocksByDay. Available IDs:`,
            Object.values(_blocksByDay).flat().map(b => b.id));
    }

    if (block && block.block_type !== 'break') {
        // Recalculate times from DOM position (block may have been dragged)
        const blockEl = el || document.querySelector(`.schedule-block[data-block-id="${blockId}"]`);
        if (blockEl) {
            const domTop = parseFloat(blockEl.style.top);
            const domHeight = parseFloat(blockEl.style.height);
            const { startHour, hourHeight } = getGridParams();
            if (!isNaN(domTop) && !isNaN(domHeight)) {
                const startTotalMin = Math.round((domTop / hourHeight) * 60) + (startHour * 60);
                const endTotalMin = startTotalMin + Math.round((domHeight / hourHeight) * 60);
                const pad = (n) => String(n).padStart(2, '0');
                block = { ...block,
                    start_time: `${targetDay}T${pad(Math.floor(startTotalMin/60))}:${pad(startTotalMin%60)}:00`,
                    end_time:   `${targetDay}T${pad(Math.floor(endTotalMin/60))}:${pad(endTotalMin%60)}:00`,
                };
            }
        }
        const container = document.getElementById('roadmap-container');
        showTaskEditModal(block,
            (updates) => handleSaveBlock(blockId, updates, container),
            () => handleDeleteBlock(blockId, block.block_type, container)
        );
    }
});

// Revert blocks to server state when drag-save fails
window.addEventListener('sf:blocks-save-failed', () => {
    const container = document.getElementById('roadmap-container');
    if (container) refreshScheduleOnly(container);
});
