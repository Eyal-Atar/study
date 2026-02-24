import { getCurrentExams, getCurrentTasks, getAPI, authFetch, setCurrentSchedule } from './store.js?v=22';
import { examColorClass, showTaskEditModal, showConfirmModal } from './ui.js?v=22';

let currentDayIndex = 0;
let dayKeys = [];
// Track active time indicator interval to prevent leaks on re-render
let _timeIndicatorInterval = null;

const EXAM_COLOR_VALUES = ['#6B47F5', '#10B981', '#F43F5E', '#F59E0B', '#38BDF8'];

export function renderExamLegend() {
    const el = document.getElementById('exam-legend');
    if (!el) return;
    const currentExams = getCurrentExams();
    if (currentExams.length === 0) {
        el.innerHTML = '<p class="text-white/30 text-sm">Add exams to see legend</p>';
        return;
    }
    // Set CSS vars so calendar blocks pick up the right per-exam color
    currentExams.forEach((_, i) => {
        document.documentElement.style.setProperty(`--exam-${i}-color`, EXAM_COLOR_VALUES[i % EXAM_COLOR_VALUES.length]);
    });
    el.innerHTML = currentExams.map((exam, i) => `
        <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full ${examColorClass(i,'bg')}"></div>
            <span class="text-sm text-white/60">${exam.name}</span>
        </div>
    `).join('');
}

// Module-level blocksByDay reference so handleDeleteBlock can do optimistic local updates
let _blocksByDay = {};

/**
 * Renders the study calendar.
 */
export function renderCalendar(tasks, schedule = []) {
    const container = document.getElementById('roadmap-container');
    if (!container) return;

    if (!tasks || tasks.length === 0) {
        container.innerHTML = `
            <div class="absolute left-[15px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-accent-500 via-mint-400 to-gold-400 opacity-20"></div>
            <div class="text-center py-12 text-white/30"><p class="text-lg">No calendar generated yet</p></div>`;
        return;
    }

    if (schedule && schedule.length > 0) {
        const blocksByDay = {};
        schedule.forEach(block => {
            if (!blocksByDay[block.day_date]) blocksByDay[block.day_date] = [];
            blocksByDay[block.day_date].push(block);
        });
        dayKeys = Object.keys(blocksByDay).sort();

        // Cache blocksByDay for optimistic local updates on delete
        _blocksByDay = blocksByDay;

        const today = new Date().toISOString().split('T')[0];
        const savedDay = localStorage.getItem('sf_selected_day');
        if (savedDay && dayKeys.includes(savedDay)) {
            currentDayIndex = dayKeys.indexOf(savedDay);
        } else if (dayKeys.includes(today)) {
            currentDayIndex = dayKeys.indexOf(today);
        } else {
            currentDayIndex = 0;
        }

        renderHourlyGrid(container, tasks, blocksByDay);
    } else {
        renderDailyList(container, tasks);
    }
}

function renderDayPicker(container, tasks, blocksByDay) {
    const day = dayKeys[currentDayIndex];
    const date = new Date(day + 'T00:00:00');
    const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
    const dayNum = date.getDate();
    const monthName = date.toLocaleDateString('en-US', { month: 'long' });
    const today = new Date().toISOString().split('T')[0];
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

function renderHourlyGrid(container, tasks, blocksByDay) {
    const day = dayKeys[currentDayIndex];
    // Filter out breaks and sort blocks
    const dayBlocks = (blocksByDay[day] || [])
        .filter(b => b.block_type !== 'break')
        .sort((a,b) => a.start_time.localeCompare(b.start_time));
        
    const currentExams = getCurrentExams();
    const examIdx = {};
    currentExams.forEach((e, i) => { examIdx[e.id] = i; });

    // Parse a backend datetime string as local time.
    // Backend stores times as local ISO without timezone (e.g. "2024-01-15T10:00:00").
    // Stripping Z ensures browsers treat the string as local, not UTC.
    const parseLocalDate = (dateStr) => {
        if (!dateStr) return new Date();
        return new Date(dateStr.replace(' ', 'T').replace(/Z$/, ''));
    };

    // Format a parsed local Date into HH:MM using the device's locale.
    const formatLocalTime = (date) => {
        if (!date || isNaN(date)) return '';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    let firstTaskHour = 24;
    dayBlocks.forEach(b => {
        const h = parseLocalDate(b.start_time).getHours();
        if (h < firstTaskHour) firstTaskHour = h;
    });
    
    // Start grid 1 hour before first task, minimum 0, maximum 12 (to always show some day)
    const startHour = Math.min(Math.max(0, firstTaskHour - 1), 12);
    
    // 1. Drastically Reduce Vertical Scale (Mobile Only)
    // Mobile: 70px, Desktop: 160px
    const HOUR_HEIGHT = window.innerWidth < 768 ? 70 : 160; 

    let html = renderDayPicker(container, tasks, blocksByDay);

    const renderedBlocks = dayBlocks.map((block) => {
        const start = parseLocalDate(block.start_time);
        const end = parseLocalDate(block.end_time);
        
        const startH = start.getHours();
        const startM = start.getMinutes();
        const endH = end.getHours();
        const endM = end.getMinutes();

        const durationMin = Math.round(Math.abs(end - start) / 60000);
        // Position relative to startHour
        const visualTop = ((startH + startM / 60) - startHour) * HOUR_HEIGHT;
        const visualHeight = (durationMin / 60) * HOUR_HEIGHT;

        const eIdx = block.exam_id !== null && block.exam_id !== -1 ? (examIdx[block.exam_id] ?? -1) : -1;
        const typeClass = `block-${block.block_type}`;
        const borderColor = eIdx !== -1 ? `var(--exam-${eIdx}-color, #6B47F5)` : '#6B47F5';
        const startTimeStr = formatLocalTime(start);
        const endTimeStr = formatLocalTime(end);
        const isDone = block.completed === 1;
        const completedClass = isDone ? 'is-completed' : '';

        // Tinted translucent backgrounds per exam color (iOS Calendar style)
        const BLOCK_BG_COLORS = [
            'rgba(107,71,245,0.18)',  // accent purple
            'rgba(16,185,129,0.18)',  // mint green
            'rgba(244,63,94,0.18)',   // coral red
            'rgba(245,158,11,0.18)', // gold amber
            'rgba(56,189,248,0.18)', // sky blue
        ];
        const blockBg = eIdx !== -1 ? BLOCK_BG_COLORS[eIdx % BLOCK_BG_COLORS.length] : BLOCK_BG_COLORS[0];

        return `
            <div class="schedule-block ${typeClass} ${completedClass} ${block.is_delayed ? 'block-delayed' : ''} group"
                 style="position: absolute; top: ${visualTop}px; height: ${visualHeight}px; left: 4px; right: 8px; border-left: 4px solid ${borderColor}; background: ${blockBg};"
                 data-task-id="${block.task_id || ''}"
                 data-block-id="${block.id || ''}"
                 data-block-type="${block.block_type}"
                 data-is-done="${isDone}">
                
                <div class="swipe-content h-full p-1.5 px-2 md:p-3">
                    <div class="flex items-start gap-2 md:gap-3 h-full">
                        <button data-task-id="${block.task_id}" data-block-id="${block.id}"
                                class="task-checkbox flex-shrink-0 w-6 h-6 mt-0.5 rounded-lg border-2 flex items-center justify-center transition-all ${isDone ? 'checked border-mint-500' : 'border-white/10 hover:border-accent-400'}"
                                style="${isDone ? 'background-color:#10B981;border-color:#10B981;' : ''}">
                            ${isDone ? '<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
                        </button>
                        
                        <div class="flex-1 min-w-0 flex flex-col justify-between h-full">
                            <div>
                                <div class="font-bold text-[11px] md:text-[13px] text-white/95 task-title-text mb-0.5 line-clamp-2" dir="auto">${block.task_title}</div>
                                <div class="flex items-baseline gap-2">
                                    <span class="text-sm md:text-base font-bold text-white">${startTimeStr}</span>
                                    ${visualHeight >= 40 ? `<span class="text-[9px] opacity-30 font-medium">${durationMin}m</span>` : ''}
                                </div>
                            </div>
                            
                            <div class="flex items-center justify-between mt-auto">
                                <span class="text-[9px] md:text-[10px] opacity-50 truncate font-medium max-w-[120px]" dir="auto">${block.exam_name || ''}</span>
                                ${block.is_delayed ? '<span class="delayed-badge scale-75 origin-right">DELAYED</span>' : ''}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="delete-reveal-btn">DELETE</div>
            </div>
        `;
    });

    const totalGridHeight = (24 - startHour) * HOUR_HEIGHT;

    html += `
        <div class="grid-day-container fade-in h-full flex-1 overflow-y-auto"
             data-day-date="${day}"
             data-start-hour="${startHour}">
            <div id="calendar-grid-wrapper" class="calendar-grid-wrapper" style="min-height: ${totalGridHeight + 32}px; padding-bottom: 32px;">
                <div style="display: flex; min-height: ${totalGridHeight}px;">
                    <!-- Time column: fixed 48px -->
                    <div class="time-col" style="width: 48px; min-width: 48px; flex-shrink: 0; position: relative; height: ${totalGridHeight}px;">
                        ${Array.from({length: 24 - startHour}).map((_, i) => {
                            const h = i + startHour;
                            return `<div class="hour-label" style="top: ${i * HOUR_HEIGHT}px;">${String(h).padStart(2, '0')}:00</div>`;
                        }).join('')}
                    </div>
                    <!-- Events column: fills remaining width -->
                    <div class="calendar-grid" style="flex: 1; position: relative; height: ${totalGridHeight}px; border-left: 1px solid rgba(255,255,255,0.06);">
                        ${Array.from({length: 24 - startHour}).map((_, i) => {
                            return `<div style="position: absolute; top: ${i * HOUR_HEIGHT}px; left: 0; right: 0; height: 1px; background: rgba(255,255,255,0.06); pointer-events: none;"></div>`;
                        }).join('')}
                        ${renderedBlocks.join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;

    // Current Time Indicator
    renderCurrentTimeIndicator(container, startHour, HOUR_HEIGHT);

    // Lightweight schedule-only refresh: avoids the full loadExams → full re-render flash
    const refreshScheduleOnly = async () => {
        const API = getAPI();
        try {
            const res = await authFetch(`${API}/schedule`);
            if (!res.ok) return;
            const newSchedule = await res.json();
            setCurrentSchedule(newSchedule);
            const newBlocksByDay = {};
            newSchedule.forEach(block => {
                if (!newBlocksByDay[block.day_date]) newBlocksByDay[block.day_date] = [];
                newBlocksByDay[block.day_date].push(block);
            });
            _blocksByDay = newBlocksByDay;
            renderHourlyGrid(container, tasks, newBlocksByDay);
        } catch (err) {
            console.error('Schedule refresh failed:', err);
        }
    };

    const handleDeleteBlock = async (blockId, blockType) => {
        const API = getAPI();
        const executeDelete = async () => {
            // Optimistic removal: remove the block element from DOM immediately
            const blockEl = container.querySelector(`.schedule-block[data-block-id="${blockId}"]`);
            if (blockEl) {
                blockEl.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
                blockEl.style.opacity = '0';
                blockEl.style.transform = 'scale(0.95)';
                setTimeout(() => blockEl.remove(), 200);
            }

            // Update local cached data so local re-renders stay correct
            const day = dayKeys[currentDayIndex];
            if (_blocksByDay[day]) {
                _blocksByDay[day] = _blocksByDay[day].filter(b => String(b.id) !== String(blockId));
            }

            try {
                await authFetch(`${API}/tasks/block/${blockId}`, { method: 'DELETE' });
                // Lightweight refresh: only re-fetch schedule (no exam cards, no stats flash)
                await refreshScheduleOnly();
            } catch (err) {
                console.error('Delete failed:', err);
                await refreshScheduleOnly();
            }
        };

        if (blockType === 'hobby') {
            showConfirmModal({
                title: "Are you sure?",
                msg: "Your brain cells might miss this break! Don't work too hard.",
                icon: "🧘",
                okText: "Delete anyway",
                onConfirm: executeDelete
            });
        } else {
            showConfirmModal({
                title: "Delete this block?",
                msg: "This will remove the scheduled time for this task.",
                icon: "🗑",
                okText: "Delete",
                onConfirm: executeDelete
            });
        }
    };

    const handleSaveBlock = async (blockId, updates) => {
        const API = getAPI();
        try {
            const block = dayBlocks.find(b => b.id == blockId);
            if (!block) return;
            const dayDate = block.day_date; // "YYYY-MM-DD"
            const newStart = `${dayDate}T${updates.startTimeStr}:00`;
            const startDate = new Date(newStart);
            const endDate = new Date(startDate.getTime() + updates.duration * 60000);

            // ── Optimistic DOM update ──────────────────────────────────────────
            // Animate the block to its new position BEFORE the API round-trip so
            // the user sees instant feedback. The CSS transition on top/height
            // (0.4s ease) will play smoothly, then the grid refreshes silently.
            const blockEl = container.querySelector(`.schedule-block[data-block-id="${blockId}"]`);
            if (blockEl) {
                const newVisualTop = ((startDate.getHours() + startDate.getMinutes() / 60) - startHour) * HOUR_HEIGHT;
                const newVisualHeight = (updates.duration / 60) * HOUR_HEIGHT;

                // Update title text immediately
                const titleEl = blockEl.querySelector('.task-title-text');
                if (titleEl && updates.title) titleEl.textContent = updates.title;

                // Update time label text immediately (the bold span showing HH:MM)
                const timeEl = blockEl.querySelector('.flex.items-baseline span.font-bold');
                if (timeEl) {
                    const newH = String(startDate.getHours()).padStart(2, '0');
                    const newM = String(startDate.getMinutes()).padStart(2, '0');
                    timeEl.textContent = `${newH}:${newM}`;
                }

                // Double-RAF ensures the browser has committed (painted) the block
                // at its CURRENT top position before we write the new value.
                // Without this, both the read and write happen in the same frame and
                // the CSS transition has no "from" state — the block teleports instead
                // of sliding. The outer RAF queues us at the start of the next frame;
                // the inner RAF fires after that frame is committed to the compositor.
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        blockEl.style.top = `${newVisualTop}px`;
                        blockEl.style.height = `${newVisualHeight}px`;
                    });
                });
            }

            // Helper for local ISO formatting
            const toLocalISO = (date) => new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 19);

            await authFetch(`${API}/tasks/block/${blockId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_title: updates.title,
                    start_time: toLocalISO(startDate),
                    end_time: toLocalISO(endDate)
                })
            });
            // Wait for the 0.4s position animation to complete before re-rendering
            // so the grid refresh doesn't interrupt the visible transition.
            await new Promise(r => setTimeout(r, 420));
            await refreshScheduleOnly();
        } catch (err) { console.error('Update failed:', err); }
    };

    // Attach click directly to each checkbox — stopImmediatePropagation prevents
    // the click from ever reaching container.onclick, eliminating double-dispatch
    container.querySelectorAll('.task-checkbox').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.stopImmediatePropagation();
            e.preventDefault();
            const taskId = parseInt(btn.dataset.taskId);
            const blockId = parseInt(btn.dataset.blockId);
            if (isNaN(taskId) || isNaN(blockId)) return;
            window.dispatchEvent(new CustomEvent('task-toggle', { detail: { taskId, blockId, btn } }));
        });
    });

    container.onclick = (e) => {
        const delBtn = e.target.closest('.delete-reveal-btn');
        if (delBtn) {
            e.stopPropagation();
            const blockEl = delBtn.closest('.schedule-block');
            handleDeleteBlock(blockEl.dataset.blockId, blockEl.dataset.blockType);
        }
    };

    // Double-tap to edit — custom implementation because ondblclick is unreliable on iOS Safari.
    // Single tap intentionally does nothing (prevents accidental opens while scrolling).
    let _lastTapTime = 0;
    let _lastTapBlock = null;
    container.addEventListener('touchend', (e) => {
        if (e.target.closest('.task-checkbox, .delete-reveal-btn')) return;
        const blockEl = e.target.closest('.schedule-block');
        if (!blockEl || blockEl.classList.contains('block-break')) return;

        const now = Date.now();
        const gap = now - _lastTapTime;

        if (gap < 300 && gap > 0 && _lastTapBlock === blockEl) {
            // Double-tap confirmed — prevent default only here (stops zoom/ghost click)
            e.preventDefault();
            _lastTapTime = 0;
            _lastTapBlock = null;
            const blockId = blockEl.dataset.blockId;
            const block = dayBlocks.find(b => b.id == blockId);
            if (block && block.block_type !== 'break') {
                showTaskEditModal(block,
                    (updates) => handleSaveBlock(blockId, updates),
                    () => handleDeleteBlock(blockId, block.block_type)
                );
            }
        } else {
            // First tap — do NOT preventDefault so scroll remains unblocked
            _lastTapTime = now;
            _lastTapBlock = blockEl;
        }
    }, { passive: false });

    // Navigation events
    const prevBtn = document.getElementById('btn-prev-day');
    const nextBtn = document.getElementById('btn-next-day');
    if (prevBtn) prevBtn.onclick = () => { if (currentDayIndex > 0) { currentDayIndex--; localStorage.setItem('sf_selected_day', dayKeys[currentDayIndex]); renderHourlyGrid(container, tasks, blocksByDay); } };
    if (nextBtn) nextBtn.onclick = () => { if (currentDayIndex < dayKeys.length - 1) { currentDayIndex++; localStorage.setItem('sf_selected_day', dayKeys[currentDayIndex]); renderHourlyGrid(container, tasks, blocksByDay); } };
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
    const today = new Date().toISOString().split('T')[0];
    const examDateSet = {};
    currentExams.forEach((e, i) => { examDateSet[e.exam_date] = { name: e.name, idx: i }; });

    let html = '<div class="absolute left-[15px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-accent-500 via-mint-400 to-gold-400 opacity-20"></div>';
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
        btn.onclick = () => {
            const event = new CustomEvent('task-toggle', { 
                detail: { taskId: parseInt(btn.dataset.taskId), btn: btn } 
            });
            window.dispatchEvent(event);
        };
    });
}

export function renderTodayFocus(tasks) {
    const today = new Date().toISOString().split('T')[0];
    const todayTasks = tasks.filter(t => t.day_date === today && t.status !== 'done');

    let html;
    if (!todayTasks.length) {
        html = '<p class="text-white/30 text-sm">No tasks for today</p>';
    } else {
        const currentExams = getCurrentExams();
        const examIdx = {};
        currentExams.forEach((e, i) => { examIdx[e.id] = i; });
        html = todayTasks.map(t => {
            const eIdx = examIdx[t.exam_id] ?? 0;
            return `<div class="flex items-center gap-2 bg-dark-900/40 rounded-lg p-2.5">
                <div class="w-2.5 h-2.5 rounded-full ${examColorClass(eIdx,'bg')}"></div>
                <div class="flex-1 text-sm truncate">${t.title}</div>
                <div class="text-xs text-white/30">${t.estimated_hours || 0}h</div>
            </div>`;
        }).join('');
    }

    const desktop = document.getElementById('today-tasks');
    if (desktop) desktop.innerHTML = html;
    const drawer = document.getElementById('today-tasks-drawer');
    if (drawer) drawer.innerHTML = html;
}

function renderCurrentTimeIndicator(container, startHour, hourHeight) {
    // Clear any previously running interval to prevent accumulation across re-renders
    if (_timeIndicatorInterval !== null) {
        clearInterval(_timeIndicatorInterval);
        _timeIndicatorInterval = null;
    }

    const grid = container.querySelector('.calendar-grid');
    if (!grid) return;

    // Only show if the current day view is TODAY
    const dayContainer = container.querySelector('.grid-day-container');
    const dayDate = dayContainer?.dataset.dayDate;
    const today = new Date().toISOString().split('T')[0];
    if (dayDate !== today) return;

    const updateLine = () => {
        // Re-query the grid each tick so we don't hold a stale reference
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

        if (h < startHour) {
            line.style.display = 'none';
            return;
        }

        line.style.display = 'block';
        const top = ((h + m / 60) - startHour) * hourHeight;
        line.style.top = `${top}px`;
    };

    updateLine();
    // Update every minute — store the ID so we can cancel it on next render
    _timeIndicatorInterval = setInterval(updateLine, 60000);
}
