import { getAPI, authFetch, getCurrentExams, setCurrentExams, getCurrentTasks, setCurrentTasks, getCurrentSchedule, setCurrentSchedule, getPendingExamId, setPendingExamId, getPendingFiles, setPendingFiles, setLatestAiDebug, getCurrentUser, getTodayStr } from './store.js?v=AUTO';
import { shakeEl, spawnConfetti, examColorClass, showModal, showConfirmModal, showScreen, LoadingAnimator } from './ui.js?v=AUTO';
import { renderCalendar, renderFocus, renderExamLegend } from './calendar.js?v=AUTO';
import { showRegenBar, hideRegenBar } from './brain.js?v=AUTO';
import { updateXPDisplay, appendNewBadges, showDailyCelebration } from './profile.js?v=AUTO';

// Notification permission prompt tracking
const NOTIF_PROMPT_KEY = 'sf_notif_prompt_shown';

// Module-level guard for daily celebration (fires once per session per day)
let _celebrationState = { shown: false, date: null };

function hasShownNotifPrompt() {
    return localStorage.getItem(NOTIF_PROMPT_KEY) === '1';
}
function markNotifPromptShown() {
    localStorage.setItem(NOTIF_PROMPT_KEY, '1');
}

// Use a proxy for _auditorDraft to trace where it is cleared or modified
let _internalAuditorDraft = null;
Object.defineProperty(window, '_auditorDraft', {
    get() { return _internalAuditorDraft; },
    set(val) {
        console.log(`[STATE] _auditorDraft changed from`, _internalAuditorDraft, `to`, val, new Error().stack);
        _internalAuditorDraft = val;
    },
    configurable: true
});

// Track edit mode: null = add mode, exam object = edit mode
let _editingExam = null;
// Existing server files loaded for the exam being edited
let _serverFiles = [];

// Wizard state for two-step auditor review
let _rejectedTopicKeys = new Set();  // "examId:topicName"
let _rejectedTaskIndexes = new Set(); // task array indexes removed in step 2
let _activeExamTab = null;            // currently selected course tab (exam_id)

/** Full refresh from server (tasks + schedule + exams). Use after defer or when sync might be off. */
export async function refreshScheduleAndFocus() {
    const API = getAPI();
    try {
        const animator = new LoadingAnimator('loading');
        showModal('loading-overlay', true);
        animator.start();

        const tres = await authFetch(`${API}/regenerate-schedule`, { method: 'POST' });
        if (!tres.ok) {
            animator.stop();
            showModal('loading-overlay', false);
            return;
        }
        const data = await tres.json();
        const tasks = data.tasks || [];
        const schedule = data.schedule || [];
        setCurrentTasks(tasks);
        setCurrentSchedule(schedule);
        updateStats();
        renderCalendar(tasks, schedule);
        renderFocus(tasks);
        const examRes = await authFetch(`${API}/exams`);
        if (examRes.ok) {
            const exams = await examRes.json();
            setCurrentExams(exams);
            renderExamCards();
            renderExamLegend();
        }
        animator.stop();
        showModal('loading-overlay', false);

        // Hard reload to ensure fresh JS and properly bound event handlers
        window.location.reload();
    } catch (e) {
        console.error('refreshScheduleAndFocus:', e);
        showModal('loading-overlay', false);
    }
}

/** After a single block/task toggle we already have correct state in memory. Only sync task status from blocks and refresh Focus + exam stats (no full calendar refetch). */
function syncAfterToggle(taskId, isBlockToggle) {
    if (isBlockToggle && taskId) {
        const schedule = getCurrentSchedule() || [];
        const taskBlocks = schedule.filter(b => b.task_id === taskId);
        if (taskBlocks.length) {
            const doneCount = taskBlocks.filter(b => b.completed === 1).length;
            const task = getCurrentTasks().find(t => t.id === taskId);
            if (task) task.status = doneCount === taskBlocks.length ? 'done' : 'pending';
        }
    }
    updateStats();
    renderFocus(getCurrentTasks());
    // Update exam progress bars in background (single light request)
    getAPI() && authFetch(`${getAPI()}/exams`).then(res => {
        if (res.ok) return res.json();
    }).then(exams => {
        if (exams) {
            setCurrentExams(exams);
            renderExamCards();
            renderExamLegend();
        }
    }).catch(() => {});
}

let _loadExamsInProgress = false;
export async function loadExams(onLogout, forceRegen = false) {
    if (_loadExamsInProgress) {
        console.log('loadExams: skipping — already in progress');
        return;
    }
    _loadExamsInProgress = true;
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/exams`);
        if (!res.ok) {
            if (res.status === 401 && onLogout) {
                onLogout();
                return;
            }
            return;
        }
        const exams = await res.json();
        setCurrentExams(exams);
        
        renderExamCards();
        updateStats();
        renderExamLegend();
        
        // Fetch existing tasks and schedule from server
        const tasksRes = await authFetch(`${API}/tasks`);
        const scheduleRes = await authFetch(`${API}/schedule`);

        let tasks = [];
        let schedule = [];
        // Track whether fetches succeeded — only regenerate if we KNOW tasks is empty,
        // not just because the fetch failed (which would silently recreate deleted blocks).
        const tasksFetchOk = tasksRes.ok;
        const scheduleFetchOk = scheduleRes.ok;

        if (tasksFetchOk) tasks = await tasksRes.json();
        if (scheduleFetchOk) schedule = await scheduleRes.json();

        setCurrentTasks(tasks);
        setCurrentSchedule(schedule);
        updateStats();
        renderCalendar(tasks, schedule);
        renderFocus(tasks);

        // ONLY regenerate if:
        // 1. forceRegen is explicitly requested, OR
        // 2. Both fetches succeeded AND tasks is genuinely empty while exams exist
        // Never regenerate if a fetch failed — that would recreate explicitly-deleted blocks.
        const tasksGenuinelyEmpty = tasksFetchOk && scheduleFetchOk && tasks.length === 0 && exams.length > 0;
        if (forceRegen || tasksGenuinelyEmpty) {
            console.log('loadExams: Triggering regenerate-schedule (forceRegen=' + forceRegen + ', genuinelyEmpty=' + tasksGenuinelyEmpty + ')...');
            const tres = await authFetch(`${API}/regenerate-schedule`, { method: 'POST' });
            if (tres.ok) {
                const data = await tres.json();
                setCurrentTasks(data.tasks);
                setCurrentSchedule(data.schedule);
                updateStats();
                renderCalendar(data.tasks, data.schedule);
                renderFocus(data.tasks);
            }
        }
    } catch (e) {
        console.error('loadExams failed:', e);
    } finally {
        _loadExamsInProgress = false;
    }
}

export function renderExamCards() {
    const currentExams = getCurrentExams();
    const container = document.getElementById('exam-cards');
    if (!container) return;

    if (currentExams.length === 0) {
        container.innerHTML = `
            <div class="fade-in flex-shrink-0 w-48 h-36 rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-accent-500/50 transition-colors" id="btn-add-first-exam">
                <div class="text-2xl mb-1 opacity-40">+</div>
                <div class="text-sm text-white/30">Add your first exam</div>
            </div>`;
        document.getElementById('btn-add-first-exam').onclick = openAddExamModal;
        renderExamCardsDrawer(currentExams);
        return;
    }

    let html = '';
    currentExams.forEach((exam, i) => {
        const days = Math.ceil((new Date(exam.exam_date) - new Date()) / 86400000);
        const progress = exam.task_count > 0 ? Math.round((exam.done_count / exam.task_count) * 100) : 0;
        html += `
        <div class="fade-in flex-shrink-0 w-56 rounded-2xl ${examColorClass(i,'bg20')} border ${examColorClass(i,'border')} p-4 card-hover">
            <div class="flex items-center justify-between mb-2">
                <div class="w-3 h-3 rounded-full ${examColorClass(i,'bg')}"></div>
                <span class="text-xs ${examColorClass(i,'text')} font-medium">${days > 0 ? days + 'd left' : days === 0 ? 'TODAY!' : 'Passed'}</span>
            </div>
            <div class="font-bold text-sm mb-1 truncate">${exam.name}</div>
            <div class="text-xs text-white/40 mb-3">${exam.subject} · ${new Date(exam.exam_date+'T00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}</div>
            <div class="h-1.5 bg-dark-900/60 rounded-full overflow-hidden mb-1">
                <div class="h-full ${examColorClass(i,'bg')} rounded-full transition-all" style="width:${progress}%"></div>
            </div>
            <div class="flex items-center justify-between">
                <span class="text-xs text-white/30">${progress}% done</span>
                <span class="text-xs text-white/30">${exam.file_count} files</span>
            </div>
            <div class="flex items-center gap-2 mt-2">
                <button data-exam-id="${exam.id}" class="btn-edit-exam text-xs text-white/20 hover:text-accent-400 transition-colors">Edit</button>
                <span class="text-white/10">·</span>
                <button data-exam-id="${exam.id}" class="btn-delete-exam text-xs text-white/20 hover:text-coral-400 transition-colors">Delete</button>
            </div>
        </div>`;
    });
    html += `
    <div class="fade-in flex-shrink-0 w-36 h-36 rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-accent-500/50 transition-colors" id="btn-add-exam-alt">
        <div class="text-2xl mb-1 opacity-40">+</div>
        <div class="text-xs text-white/30">Add Exam</div>
    </div>`;
    container.innerHTML = html;

    // Bind events
    const addBtn = document.getElementById('btn-add-exam-alt');
    if (addBtn) addBtn.onclick = openAddExamModal;

    container.querySelectorAll('.btn-edit-exam').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const exam = getCurrentExams().find(ex => ex.id === parseInt(btn.dataset.examId));
            if (exam) openEditExamModal(exam);
        };
    });

    container.querySelectorAll('.btn-delete-exam').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            deleteExam(btn.dataset.examId);
        };
    });

    renderExamCardsDrawer(currentExams);
}

function renderExamCardsDrawer(exams) {
    const container = document.getElementById('exam-cards-drawer');
    if (!container) return;
    if (exams.length === 0) {
        container.innerHTML = '<p class="text-white/30 text-sm">No exams yet</p>';
        return;
    }
    container.innerHTML = exams.map((exam, i) => {
        const days = Math.ceil((new Date(exam.exam_date) - new Date()) / 86400000);
        const progress = exam.task_count > 0 ? Math.round((exam.done_count / exam.task_count) * 100) : 0;
        const daysLabel = days > 0 ? `${days}d left` : days === 0 ? 'TODAY!' : 'Passed';
        return `<div class="flex items-center gap-3 p-2.5 rounded-xl ${examColorClass(i,'bg20')} border ${examColorClass(i,'border')}">
            <div class="w-2.5 h-2.5 rounded-full flex-shrink-0 ${examColorClass(i,'bg')}"></div>
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm truncate">${exam.name}</div>
                <div class="text-xs text-white/40">${exam.subject} · ${daysLabel} · ${progress}%</div>
            </div>
            <button data-exam-id="${exam.id}" class="btn-edit-exam-drawer text-xs text-white/30 hover:text-accent-400 transition-colors px-1.5 py-1 flex-shrink-0">Edit</button>
        </div>`;
    }).join('');
    container.querySelectorAll('.btn-edit-exam-drawer').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const exam = getCurrentExams().find(ex => ex.id === parseInt(btn.dataset.examId));
            if (exam) openEditExamModal(exam);
        };
    });
}

export function updateStats() {
    const currentExams = getCurrentExams();
    const currentTasks = getCurrentTasks();

    const pending = currentTasks.filter(t => t.status !== 'done');
    const done = currentTasks.filter(t => t.status === 'done');
    const hours = pending.reduce((s, t) => s + t.estimated_hours, 0);

    const setStatEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
        const elD = document.getElementById(id + '-desktop');
        if (elD) elD.textContent = val;
    };

    setStatEl('stat-exams', currentExams.length);
    setStatEl('stat-hours', hours.toFixed(1) + 'h');

    // --- Daily Progress against neto_study_hours quota ---
    const user = getCurrentUser();
    const netoStudyHours = parseFloat(user?.neto_study_hours) || 4.0;
    const today = getTodayStr();
    const schedule = getCurrentSchedule() || [];
    const todayDoneMin = schedule
        .filter(b => b.day_date === today && b.block_type === 'study' && b.completed === 1)
        .reduce((sum, b) => {
            const start = new Date(b.start_time.replace(' ', 'T').replace(/Z$/, ''));
            const end = new Date(b.end_time.replace(' ', 'T').replace(/Z$/, ''));
            return sum + Math.round(Math.abs(end - start) / 60000);
        }, 0);
    const quotaMin = netoStudyHours * 60;
    const dailyPct = Math.min(100, Math.round((todayDoneMin / quotaMin) * 100));
    const doneFrac = `${Math.round(todayDoneMin / 60 * 10) / 10}/${netoStudyHours}h`;

    ['stat-done', 'stat-done-desktop'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = `${dailyPct}%`;
    });

    const progressBar = document.getElementById('daily-quota-progress');
    if (progressBar) progressBar.style.width = `${dailyPct}%`;
    const progressBarDesktop = document.getElementById('daily-quota-progress-desktop');
    if (progressBarDesktop) progressBarDesktop.style.width = `${dailyPct}%`;

    ['stat-done-sublabel', 'stat-done-sublabel-desktop'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = doneFrac;
    });

    const upcoming = currentExams.filter(e => new Date(e.exam_date) >= new Date());
    if (upcoming.length > 0) {
        const nearest = upcoming.sort((a, b) => new Date(a.exam_date) - new Date(b.exam_date))[0];
        const days = Math.ceil((new Date(nearest.exam_date) - new Date()) / 86400000);
        setStatEl('stat-days', days);
        ['stat-days-label', 'stat-days-label-desktop'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = `days · ${nearest.subject}`;
        });
    } else {
        setStatEl('stat-days', '—');
        ['stat-days-label', 'stat-days-label-desktop'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = 'days away';
        });
    }
}

/** Check if all study blocks for today are done. If so, show celebration. */
function checkAndShowDailyCelebration() {
    const today = getTodayStr();

    // Reset if date has rolled over
    if (_celebrationState.date !== today) {
        _celebrationState = { shown: false, date: today };
    }

    if (_celebrationState.shown) return;

    const schedule = getCurrentSchedule() || [];
    const todayStudyBlocks = schedule.filter(
        b => b.day_date === today && b.block_type === 'study'
    );

    // Need at least one study block to avoid false-positive on empty days
    if (todayStudyBlocks.length === 0) return;

    const allDone = todayStudyBlocks.every(b => b.completed === 1);
    if (!allDone) return;

    _celebrationState.shown = true;

    // Delay slightly so per-block confetti finishes first
    setTimeout(() => {
        showDailyCelebration();
    }, 500);
}

export async function deleteExam(examId) {
    if (!confirm('Delete this exam and all its files?')) return;
    
    showModal('loading-overlay', true);
    const API = getAPI();
    try {
        await authFetch(`${API}/exams/${examId}`, { method: 'DELETE' });
        await loadExams();
        const currentExams = getCurrentExams();
        if (currentExams.length === 0) {
            // Forcefully clear all roadmap-related state when no exams remain
            setCurrentTasks([]);
            setCurrentSchedule([]);
            renderCalendar([], []);
            renderFocus([]);
            updateStats();
        }
    } catch (e) {
        console.error('Delete failed:', e);
    } finally {
        showModal('loading-overlay', false);
    }
}

const _togglingTasks = new Set();

export async function toggleDone(taskId, btn, blockId = null) {
    const lockKey = blockId ? `block-${blockId}` : `task-${taskId}`;
    if (_togglingTasks.has(lockKey)) return;
    _togglingTasks.add(lockKey);

    const isBlockToggle = blockId != null;
    const currentTasks = getCurrentTasks();
    const currentSchedule = getCurrentSchedule();
    const task = taskId ? currentTasks.find(t => t.id === taskId) : null;
    if (!task && !isBlockToggle) {
        _togglingTasks.delete(lockKey);
        return;
    }

    const block = isBlockToggle ? currentSchedule.find(b => b.id === blockId) : null;
    if (isBlockToggle && !block) {
        _togglingTasks.delete(lockKey);
        return;
    }

    const isDone = isBlockToggle ? (block?.completed === 1) : (task?.status === 'done');
    const API = getAPI();
    
    // Optimistic Update
    if (isBlockToggle && block) {
        block.completed = isDone ? 0 : 1;
    } else if (task) {
        task.status = isDone ? 'pending' : 'done';
    }

    if (!isDone) spawnConfetti(btn);
    
    // Update visual state
    if (isBlockToggle && blockId) {
        const blockEl = document.querySelector(`.schedule-block[data-block-id="${blockId}"]`);
        if (blockEl) {
            if (!isDone) {
                blockEl.classList.add('is-completed', 'just-completed');
                blockEl.setAttribute('data-is-done', 'true');
                const checkbox = blockEl.querySelector('.task-checkbox');
                if (checkbox) {
                    checkbox.classList.add('checked', 'border-mint-500');
                    checkbox.classList.remove('border-white/10');
                    checkbox.style.backgroundColor = '#10B981';
                    checkbox.style.borderColor = '#10B981';
                    checkbox.innerHTML = '<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>';
                }
                setTimeout(() => blockEl.classList.remove('just-completed'), 6000);
            } else {
                blockEl.classList.remove('is-completed', 'just-completed');
                blockEl.setAttribute('data-is-done', 'false');
                const checkbox = blockEl.querySelector('.task-checkbox');
                if (checkbox) {
                    checkbox.classList.remove('checked', 'border-mint-500');
                    checkbox.classList.add('border-white/10');
                    checkbox.style.backgroundColor = '';
                    checkbox.style.borderColor = '';
                    checkbox.innerHTML = '';
                }
            }
        }
    } else {
        // Toggle from Focus: sync schedule in memory and DOM so Roadmap shows same state
        (currentSchedule || []).forEach(b => {
            if (b.task_id === taskId) b.completed = isDone ? 0 : 1;
        });
        const blocks = document.querySelectorAll(`.schedule-block[data-task-id="${taskId}"]`);
        blocks.forEach(b => {
            if (!isDone) {
                b.classList.add('is-completed');
                b.setAttribute('data-is-done', 'true');
                const checkbox = b.querySelector('.task-checkbox');
                if (checkbox) {
                    checkbox.classList.add('checked', 'border-mint-500');
                    checkbox.classList.remove('border-white/10');
                    checkbox.style.backgroundColor = '#10B981';
                    checkbox.style.borderColor = '#10B981';
                    checkbox.innerHTML = '<svg class="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>';
                }
            } else {
                b.classList.remove('is-completed');
                b.setAttribute('data-is-done', 'false');
                const checkbox = b.querySelector('.task-checkbox');
                if (checkbox) {
                    checkbox.classList.remove('checked', 'border-mint-500');
                    checkbox.classList.add('border-white/10');
                    checkbox.style.backgroundColor = '';
                    checkbox.style.borderColor = '';
                    checkbox.innerHTML = '';
                }
            }
        });
    }

    // Update Stats and UI immediately
    updateStats();
    renderFocus(getCurrentTasks());

    try {
        const endpoint = isBlockToggle 
            ? `${API}/tasks/block/${blockId}/${isDone ? 'undone' : 'done'}`
            : `${API}/tasks/${taskId}/${isDone ? 'undone' : 'done'}`;
            
        const patchRes = await authFetch(endpoint, { method: 'PATCH' });
        if (!patchRes.ok) throw new Error(`PATCH failed: ${patchRes.status}`);

        // Permission onboarding: show after first ever task marked Done
        if (!isDone && !hasShownNotifPrompt() && 'Notification' in window && Notification.permission === 'default') {
            const currentDoneCount = getCurrentTasks().filter(t => t.status === 'done').length
                + (getCurrentSchedule() ? getCurrentSchedule().filter(b => b.completed === 1).length : 0);
            if (currentDoneCount >= 1) {
                markNotifPromptShown();
                setTimeout(() => {
                    const modal = document.getElementById('modal-notif-permission');
                    if (modal) modal.classList.add('active');
                }, 1500); // small delay so confetti finishes first
            }
        }

        // Gamification: award XP when a block is marked done (fire-and-forget, non-blocking)
        if (patchRes.ok && !isDone && isBlockToggle && blockId) {
            authFetch(`${API}/gamification/award-xp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_id: taskId, block_id: blockId })
            })
                .then(r => r.json())
                .then(xpResult => {
                    if (xpResult && xpResult.xp_earned > 0) {
                        updateXPDisplay(xpResult);   // animate circles live
                    }
                    if (xpResult && xpResult.badges_earned && xpResult.badges_earned.length > 0) {
                        appendNewBadges(xpResult.badges_earned);
                    }
                })
                .catch(e => {
                    console.warn('XP award failed:', e);
                });

            // Check if all of today's study blocks are completed to show celebration screen
            checkAndShowDailyCelebration();
        }

        // We already updated DOM and store; only sync task status from blocks and refresh Focus + exam stats (no full refetch)
        syncAfterToggle(taskId, isBlockToggle);
    } catch (e) {
        console.error("Sync failed:", e);
        // Rollback optimistic update
        if (isBlockToggle && block) {
            block.completed = isDone ? 1 : 0;
        } else {
            if (task) task.status = isDone ? 'done' : 'pending';
            (currentSchedule || []).forEach(b => {
                if (b.task_id === taskId) b.completed = isDone ? 1 : 0;
            });
        }
        updateStats();
        renderFocus(getCurrentTasks());
        window.dispatchEvent(new CustomEvent('calendar-needs-refresh'));
    } finally {
        _togglingTasks.delete(lockKey);
    }
}

/** Defer a schedule block to the next calendar day (push-to-next-day). Refreshes schedule and calendar. */
export async function deferBlockToTomorrow(blockId) {
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/tasks/block/${blockId}/defer`, { method: 'POST' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || err.error || `Defer failed: ${res.status}`);
        }
        const tres = await authFetch(`${API}/regenerate-schedule`, { method: 'POST' });
        if (!tres.ok) return;
        const data = await tres.json();
        setCurrentTasks(data.tasks || []);
        setCurrentSchedule(data.schedule || []);
        updateStats();
        renderExamCards();
        renderExamLegend();
        renderCalendar(data.tasks || [], data.schedule || []);
        renderFocus(data.tasks || []);
    } catch (e) {
        console.error('Defer failed:', e);
        window.dispatchEvent(new CustomEvent('calendar-needs-refresh'));
    }
}

export async function generateRoadmap() {
    const currentExams = getCurrentExams();
    if (currentExams.length === 0) {
        alert('Add exams first!');
        return;
    }

    const animator = new LoadingAnimator('loading');
    showModal('loading-overlay', true);
    animator.start();

    const API = getAPI();
    try {
        const res = await authFetch(`${API}/generate-roadmap`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
            animator.stop();
            showModal('loading-overlay', false);
            alert(data.detail || 'Failed to generate roadmap');
            return;
        }

        animator.stop();
        showModal('loading-overlay', false);

        // Store auditor draft in memory and navigate to the review screen
        window._auditorDraft = {
            tasks: data.tasks || [],
            gaps: data.gaps || [],
            topic_map: data.topic_map || {}
        };
        renderAuditorReview(window._auditorDraft);
        showScreen('screen-auditor-review');
        hideRegenBar();
    } catch (e) {
        animator.stop();
        showModal('loading-overlay', false);
        alert('Failed to generate roadmap. Check server logs.');
    }
}

/** Render the Auditor Review Screen as a two-step wizard. */
export function renderAuditorReview(data) {
    // Reset wizard state
    _rejectedTopicKeys = new Set();
    _rejectedTaskIndexes = new Set();
    _activeExamTab = null;

    // Always start on step 1
    _showWizardStep(1);
    _renderWizardStep1(data);
}

/** Show the correct wizard step (1=Topics, 2=Gaps, 3=Tasks) and update stepper UI. */
function _showWizardStep(step) {
    const steps = [
        document.getElementById('wizard-step-1'),
        document.getElementById('wizard-step-2'),
        document.getElementById('wizard-step-3')
    ];
    const title = document.getElementById('wizard-title');
    const subtitle = document.getElementById('wizard-subtitle');
    const stepperSteps = document.querySelectorAll('#wizard-stepper .wizard-step');
    const stepperLines = document.querySelectorAll('#wizard-stepper .wizard-step-line');

    const titles = [
        ['Choose Your Topics', 'Remove topics you already know — keep what you need to study'],
        ['Review Detected Gaps', 'Gaps are missing topics the AI found — dismiss or add tasks for them'],
        ['Review Tasks', 'Remove tasks you don\'t need — everything else goes into your schedule']
    ];

    // Show only the active step
    steps.forEach((el, i) => { if (el) el.style.display = i === step - 1 ? '' : 'none'; });

    // Update header
    if (title) title.textContent = titles[step - 1][0];
    if (subtitle) subtitle.textContent = titles[step - 1][1];

    // Update stepper circles and lines
    stepperSteps.forEach((el, i) => {
        const stepNum = i + 1;
        el.classList.toggle('active', stepNum === step);
        el.classList.toggle('completed', stepNum < step);
    });
    stepperLines.forEach((el, i) => {
        const afterStep = i + 1; // line[0] is after step 1, line[1] is after step 2
        el.classList.toggle('active', afterStep === step);
        el.classList.toggle('completed', afterStep < step);
    });
}

/** Step 1: Render topics per exam + gaps with accordions. */
function _renderWizardStep1(data) {
    const topicMap = data.topic_map || {};
    const exams = getCurrentExams() || [];

    // --- Topics ---
    const topicListEl = document.getElementById('wizard-topic-list');
    if (topicListEl) {
        if (Object.keys(topicMap).length === 0) {
            topicListEl.innerHTML = `<p class="text-white/30 text-sm">No topics detected from your materials.</p>`;
        } else {
            let html = '';
            for (const [examId, topics] of Object.entries(topicMap)) {
                const exam = exams.find(e => String(e.id) === String(examId));
                const examName = exam ? exam.name : `Exam ${examId}`;
                html += `<div class="bg-dark-700/60 rounded-2xl p-4 border border-white/5">
                    <div class="font-medium text-sm mb-3 text-accent-400">${examName}</div>
                    <div class="flex flex-wrap gap-2">
                        ${(topics || []).map(t => {
                            const key = `${examId}:${t}`;
                            const removed = _rejectedTopicKeys.has(key);
                            return `<div class="topic-pill ${removed ? 'removed' : ''}" data-topic-key="${key}">
                                <span class="pill-toggle">${removed ? '' : '✓'}</span>
                                <span>${t}</span>
                            </div>`;
                        }).join('')}
                    </div>
                </div>`;
            }
            topicListEl.innerHTML = html;
        }
    }

    // Bind topic pill clicks
    document.querySelectorAll('.topic-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            const key = pill.dataset.topicKey;
            if (_rejectedTopicKeys.has(key)) {
                _rejectedTopicKeys.delete(key);
                pill.classList.remove('removed');
                pill.querySelector('.pill-toggle').textContent = '✓';
            } else {
                _rejectedTopicKeys.add(key);
                pill.classList.add('removed');
                pill.querySelector('.pill-toggle').textContent = '';
            }
        });
    });

}

/** Step 2: Render detected gaps with accordions and actions. */
function _renderWizardStep2Gaps(data) {
    const gaps = data.gaps || [];
    const exams = getCurrentExams() || [];
    const gapsList = document.getElementById('wizard-gaps-list');
    const gapsSection = document.getElementById('wizard-gaps-section');

    if (gapsList) {
        if (gaps.length === 0) {
            gapsList.innerHTML = `<div class="text-center py-8">
                <div class="text-3xl mb-3">✅</div>
                <p class="text-white/50 text-sm">No gaps detected — your materials cover all topics.</p>
            </div>`;
        } else {
            gapsList.innerHTML = gaps.map((gap, i) => {
                const exam = exams.find(e => e.id === gap.exam_id);
                const examLabel = exam ? exam.name : '';
                return `
                <div class="gap-item wizard-accordion bg-coral-500/10 border border-coral-500/20 rounded-xl p-3" data-gap-index="${i}">
                    <div class="flex items-center justify-between gap-2 wizard-accordion-trigger">
                        <div class="flex items-center gap-2 flex-1 min-w-0">
                            <span class="wizard-accordion-arrow">▶</span>
                            <div class="flex-1 min-w-0">
                                <span class="text-sm font-medium text-coral-400 truncate block">${gap.topic}</span>
                                ${examLabel ? `<span class="text-[10px] text-white/30">${examLabel}</span>` : ''}
                            </div>
                        </div>
                        <div class="flex gap-2 flex-shrink-0">
                            <button class="btn-add-search-task text-xs bg-accent-500/20 text-accent-400 px-2 py-1 rounded-lg hover:bg-accent-500/30 transition-colors" data-gap-index="${i}" data-gap-topic="${gap.topic}" data-gap-exam-id="${gap.exam_id}">+ Task</button>
                            <button class="btn-dismiss-gap text-xs text-white/30 hover:text-white/60 px-2 py-1 rounded-lg transition-colors" data-gap-index="${i}">Dismiss</button>
                        </div>
                    </div>
                    <div class="wizard-accordion-content">
                        <div class="text-xs text-white/40 mt-2 pl-5">${gap.description || 'Topic in syllabus but no study material found'}</div>
                    </div>
                </div>`;
            }).join('');
        }
    }

    // Bind accordion triggers
    const container = document.getElementById('wizard-step-2');
    if (!container) return;

    container.querySelectorAll('.wizard-accordion-trigger').forEach(trigger => {
        trigger.addEventListener('click', (e) => {
            if (e.target.closest('.btn-add-search-task') || e.target.closest('.btn-dismiss-gap')) return;
            const accordion = trigger.closest('.wizard-accordion');
            if (accordion) accordion.classList.toggle('wizard-accordion-open');
        });
    });

    container.querySelectorAll('.btn-dismiss-gap').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const gapEl = btn.closest('.gap-item');
            if (gapEl) gapEl.remove();
        });
    });

    container.querySelectorAll('.btn-add-search-task').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const topic = btn.dataset.gapTopic;
            const examId = parseInt(btn.dataset.gapExamId, 10);
            _addSearchTaskFromGap(topic, examId);
            const gapEl = btn.closest('.gap-item');
            if (gapEl) gapEl.remove();
        });
    });
}

/** Step 3: Render tasks filtered by rejected topics, grouped by course tabs. */
function _renderWizardStep3() {
    const draft = window._auditorDraft;
    if (!draft) return;

    const tasks = draft.tasks || [];
    const exams = getCurrentExams() || [];

    // Filter out tasks whose topic was rejected in step 1
    const filteredTasks = tasks.map((t, i) => ({ ...t, _origIndex: i })).filter(t => {
        const topicKey = `${t.exam_id}:${t.topic}`;
        return !_rejectedTopicKeys.has(topicKey);
    });

    // Reset step-2 rejections (user may go back and forth)
    _rejectedTaskIndexes = new Set();

    // Build course tabs
    const examIds = [...new Set(filteredTasks.map(t => t.exam_id))];
    const tabsEl = document.getElementById('wizard-course-tabs');
    if (tabsEl) {
        if (examIds.length <= 1) {
            tabsEl.style.display = 'none';
        } else {
            tabsEl.style.display = '';
            tabsEl.innerHTML = examIds.map(eid => {
                const exam = exams.find(e => e.id === eid);
                const name = exam ? exam.name : `Exam ${eid}`;
                return `<button class="wizard-course-tab" data-exam-id="${eid}">${name}</button>`;
            }).join('');
        }
    }

    // Set initial active tab
    _activeExamTab = examIds.length > 0 ? examIds[0] : null;

    // Render tasks
    _renderFilteredTasks(filteredTasks);

    // Bind tab clicks
    document.querySelectorAll('.wizard-course-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            _activeExamTab = parseInt(tab.dataset.examId, 10) || tab.dataset.examId;
            document.querySelectorAll('.wizard-course-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            _renderFilteredTasks(filteredTasks);
        });
    });

    // Activate first tab
    const firstTab = document.querySelector('.wizard-course-tab');
    if (firstTab) firstTab.classList.add('active');
}

/** Render task list filtered by active exam tab. */
function _renderFilteredTasks(allFilteredTasks) {
    const tasksList = document.getElementById('wizard-tasks-list');
    if (!tasksList) return;

    const exams = getCurrentExams() || [];
    const visibleTasks = _activeExamTab
        ? allFilteredTasks.filter(t => String(t.exam_id) === String(_activeExamTab))
        : allFilteredTasks;

    if (visibleTasks.length === 0) {
        tasksList.innerHTML = `<p class="text-white/30 text-sm py-4 text-center">No tasks for this course.</p>`;
        return;
    }

    tasksList.innerHTML = visibleTasks.map(t => {
        const exam = exams.find(e => e.id === t.exam_id);
        const examLabel = exam ? exam.name : '';
        const reasoning = t.reasoning || '';

        return `<div class="wizard-task-item wizard-accordion" data-task-index="${t._origIndex}">
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    ${reasoning ? `<span class="wizard-accordion-trigger wizard-accordion-arrow flex-shrink-0 cursor-pointer">▶</span>` : ''}
                    <div class="text-sm font-medium">${t.title}</div>
                </div>
                ${reasoning ? `<div class="wizard-accordion-content">
                    <div class="text-xs text-white/40 mt-1.5 ${reasoning ? 'pl-5' : ''}">${reasoning}</div>
                </div>` : ''}
            </div>
            <button class="wizard-task-remove" data-task-index="${t._origIndex}">✕</button>
        </div>`;
    }).join('');

    // Bind accordion triggers for reasoning
    tasksList.querySelectorAll('.wizard-accordion-trigger').forEach(trigger => {
        trigger.addEventListener('click', () => {
            const item = trigger.closest('.wizard-accordion');
            if (item) item.classList.toggle('wizard-accordion-open');
        });
    });

    // Bind remove buttons
    tasksList.querySelectorAll('.wizard-task-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = parseInt(btn.dataset.taskIndex, 10);
            _rejectedTaskIndexes.add(idx);
            const item = btn.closest('.wizard-task-item');
            if (item) {
                item.classList.add('removing');
                setTimeout(() => item.remove(), 250);
            }
        });
    });
}

/** Add a "Search Task" from a detected gap to the pending tasks. */
function _addSearchTaskFromGap(topic, examId) {
    if (!window._auditorDraft) return;
    const newIndex = window._auditorDraft.tasks.length;
    const searchTask = {
        task_index: newIndex,
        exam_id: examId,
        title: `Search for material on: ${topic}`,
        topic: topic,
        estimated_hours: 1.0,
        focus_score: 3,
        reasoning: 'Material gap — search and collect study resources',
        dependency_id: null,
        sort_order: 9999
    };
    window._auditorDraft.tasks.push(searchTask);
}

/** Navigate wizard: step 1 → step 2 (gaps). */
export function wizardGoToStep2() {
    _showWizardStep(2);
    _renderWizardStep2Gaps(window._auditorDraft);
}

/** Navigate wizard: step 2 → step 3 (tasks). */
export function wizardGoToStep3() {
    _showWizardStep(3);
    _renderWizardStep3();
}

/** Navigate wizard back to step 1 (from step 2). */
export function wizardBackToStep1() {
    _showWizardStep(1);
}

/** Navigate wizard back to step 2 (from step 3). */
export function wizardBackToStep2() {
    _showWizardStep(2);
    // Gaps already rendered, DOM state preserved
}

/** Collect approved tasks (excluding rejected) and POST to /brain/approve-and-schedule. */
export async function approveSchedule() {
    const draft = window._auditorDraft;
    if (!draft || !draft.tasks) {
        alert('No roadmap to approve.');
        return;
    }

    // Filter: exclude topics rejected in step 1, then tasks rejected in step 2
    const approvedTasks = draft.tasks.filter((t, i) => {
        const topicKey = `${t.exam_id}:${t.topic}`;
        if (_rejectedTopicKeys.has(topicKey)) return false;
        if (_rejectedTaskIndexes.has(i)) return false;
        return true;
    });

    if (approvedTasks.length === 0) {
        alert('Please keep at least one task to generate a schedule.');
        return;
    }

    const animator = new LoadingAnimator('loading');
    showModal('loading-overlay', true);
    animator.start();

    const API = getAPI();
    try {
        const res = await authFetch(`${API}/approve-and-schedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ approved_tasks: approvedTasks })
        });
        const data = await res.json();
        if (!res.ok) {
            animator.stop();
            showModal('loading-overlay', false);
            alert(data.detail || 'Failed to generate schedule');
            return;
        }

        // Clear the draft
        window._auditorDraft = null;

        // Update local state with the new tasks and schedule
        setCurrentTasks(data.tasks || []);
        setCurrentSchedule(data.schedule || []);
        updateStats();
        renderCalendar(data.tasks || [], data.schedule || []);
        renderFocus(data.tasks || []);

        // Refresh exam cards (task counts updated)
        const examRes = await authFetch(`${API}/exams`);
        if (examRes.ok) {
            const exams = await examRes.json();
            setCurrentExams(exams);
            renderExamCards();
            renderExamLegend();
        }

        animator.stop();
        showModal('loading-overlay', false);

        // Hard reload: guarantees fresh JS from the server, re-initializes all
        // event handlers (double-tap, dblclick, drag), and triggers SW update.
        // The dashboard will load normally from server data on the fresh page.
        // This is the only reliable way to ensure all interaction handlers are
        // properly bound after a full schedule rebuild — the service worker's
        // cache-first strategy otherwise serves stale JS that lacks fixes.
        window.location.reload();
    } catch (e) {
        animator.stop();
        showModal('loading-overlay', false);
        console.error('approveSchedule error:', e);
        alert(`Failed to generate schedule: ${e.message || 'Unknown error'}`);
    }
}

/** Check for a stored Auditor draft on app init. If found, offer to resume the review. */
export async function checkAuditorDraftOnInit() {
    // GUARD: If we already have a draft in memory (maybe just generated or resumed),
    // do NOT overwrite it or show the banner again.
    if (window._auditorDraft) {
        console.log("checkAuditorDraftOnInit: skipping check, _auditorDraft already in memory");
        return;
    }

    const API = getAPI();
    try {
        const res = await authFetch(`${API}/auditor-draft`);
        if (!res.ok) return; // 404 = no draft, that's fine
        const draft = await res.json();
        if (!draft || !draft.tasks || draft.tasks.length === 0) return;

        // Store draft and show a banner offering to resume
        window._auditorDraft = draft;
        _showResumeBanner();
    } catch (e) {
        // Non-fatal: draft simply doesn't exist or network error
    }
}

function _showResumeBanner() {
    // Show a small notification banner at the top of the dashboard
    const existing = document.getElementById('auditor-resume-banner');
    if (existing) return; // already shown
    
    const reviewScreen = document.getElementById('screen-auditor-review');
    if (reviewScreen && reviewScreen.classList.contains('active')) {
        console.log("_showResumeBanner: skipping, review screen already active");
        return;
    }

    const banner = document.createElement('div');
    banner.id = 'auditor-resume-banner';
    banner.className = 'fixed top-0 left-0 right-0 z-50 bg-accent-500/95 text-white flex items-center justify-between px-4 py-3 text-sm font-medium shadow-lg';
    banner.innerHTML = `
        <span>AI analysis ready — continue reviewing your study plan?</span>
        <div class="flex gap-2 ml-3">
            <button id="btn-resume-review" class="bg-white text-accent-600 px-3 py-1 rounded-lg text-xs font-bold hover:bg-white/90 transition-colors">Resume Review</button>
            <button id="btn-dismiss-resume" class="text-white/70 hover:text-white text-xs px-2">Dismiss</button>
        </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('btn-resume-review').addEventListener('click', () => {
        banner.remove();
        renderAuditorReview(window._auditorDraft);
        showScreen('screen-auditor-review');
    });
    document.getElementById('btn-dismiss-resume').addEventListener('click', async () => {
        banner.remove();
        window._auditorDraft = null;
        // Clear draft from DB so the banner doesn't reappear on reload
        try {
            const API = getAPI();
            await authFetch(`${API}/auditor-draft`, { method: 'DELETE' });
        } catch (_) { /* non-fatal */ }
    });
}

// ─── Add Exam Modal Logic ────────────────────────────

export function openAddExamModal() {
    _editingExam = null;
    _serverFiles = [];
    const modal = document.getElementById('modal-add-exam');
    if (!modal) return;
    modal.classList.add('active');
    document.getElementById('modal-step-1').style.display = 'block';
    document.getElementById('modal-step-2').style.display = 'none';
    const titleEl = document.getElementById('modal-step1-title');
    if (titleEl) titleEl.textContent = 'Add Exam';
    const nextBtn = document.getElementById('btn-modal-to-step-2');
    if (nextBtn) nextBtn.textContent = 'Next: Upload Files';
    document.getElementById('exam-name').value = '';
    document.getElementById('exam-subject').value = '';
    document.getElementById('exam-date').value = '';
    setPendingExamId(null);
    setPendingFiles([]);
    document.getElementById('uploaded-files-list').innerHTML = '';
    setTimeout(() => document.getElementById('exam-name').focus(), 100);
}

export async function openEditExamModal(exam) {
    _editingExam = exam;
    _serverFiles = [];
    const modal = document.getElementById('modal-add-exam');
    if (!modal) return;
    modal.classList.add('active');
    document.getElementById('modal-step-1').style.display = 'block';
    document.getElementById('modal-step-2').style.display = 'none';
    const titleEl = document.getElementById('modal-step1-title');
    if (titleEl) titleEl.textContent = 'Edit Exam';
    const nextBtn = document.getElementById('btn-modal-to-step-2');
    if (nextBtn) nextBtn.textContent = 'Next: Manage Files';
    document.getElementById('exam-name').value = exam.name;
    document.getElementById('exam-subject').value = exam.subject;
    document.getElementById('exam-date').value = exam.exam_date;
    setPendingExamId(exam.id);
    setPendingFiles([]);
    document.getElementById('uploaded-files-list').innerHTML = '';
    setTimeout(() => document.getElementById('exam-name').focus(), 100);
}

export function closeAddExamModal() {
    const modal = document.getElementById('modal-add-exam');
    if (modal) modal.classList.remove('active');
    _editingExam = null;
    _serverFiles = [];
}

export async function modalToStep2() {
    const name = document.getElementById('exam-name').value.trim();
    const subject = document.getElementById('exam-subject').value.trim();
    const date = document.getElementById('exam-date').value;
    if (!name) { shakeEl('exam-name'); return; }
    if (!subject) { shakeEl('exam-subject'); return; }
    if (!date) { shakeEl('exam-date'); return; }

    const API = getAPI();

    if (_editingExam) {
        // Edit mode: PATCH the existing exam
        const dateChanged = _editingExam.exam_date !== date;
        try {
            const res = await authFetch(`${API}/exams/${_editingExam.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    subject,
                    exam_date: date,
                    special_needs: null
                }),
            });
            const exam = await res.json();
            if (!res.ok) { alert(exam.detail || 'Failed to update exam'); return; }
            // Store whether date changed so the Done button can trigger the regen bar
            _editingExam = { ..._editingExam, _dateChanged: dateChanged };
        } catch (e) {
            alert('Failed to update exam');
            return;
        }
        // Load existing files for step 2
        try {
            const fRes = await authFetch(`${API}/exams/${getPendingExamId()}/files`);
            if (fRes.ok) { _serverFiles = await fRes.json(); }
        } catch (_) { /* non-fatal */ }
    } else {
        // Add mode: POST a new exam
        try {
            const res = await authFetch(`${API}/exams`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    subject,
                    exam_date: date,
                    special_needs: null
                }),
            });
            const exam = await res.json();
            if (!res.ok) { alert(exam.detail || 'Failed'); return; }
            setPendingExamId(exam.id);
        } catch (e) {
            alert('Failed to create exam');
            return;
        }
    }

    document.getElementById('modal-exam-title').textContent = `Files for: ${name}`;
    document.getElementById('modal-step-1').style.display = 'none';
    document.getElementById('modal-step-2').style.display = 'block';
    renderUploadedFiles();
}

export async function handleFileSelect(input) {
    const files = Array.from(input.files);
    const pendingExamId = getPendingExamId();
    if (!files.length || !pendingExamId) return;
    
    // Check limit: existing server files + currently pending + new ones
    const currentTotal = _serverFiles.length + getPendingFiles().length;
    if (currentTotal + files.length > 3) {
        alert(`You can upload a maximum of 3 files per exam. You already have ${currentTotal} files.`);
        input.value = '';
        return;
    }

    const fileType = document.getElementById('file-type-select').value;
    const prog = document.getElementById('upload-progress');
    if (prog) prog.classList.remove('hidden');
    
    const API = getAPI();
    
    for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('file_type', fileType);
        
        try {
            const res = await authFetch(`${API}/exams/${pendingExamId}/upload`, { method: 'POST', body: formData });
            const data = await res.json();
            if (res.ok) {
                const pending = getPendingFiles();
                pending.push(data);
                setPendingFiles(pending);
                renderUploadedFiles();
            } else {
                alert(`Upload failed for ${file.name}: ${data.detail || 'Unknown error'}`);
            }
        } catch (e) {
            console.error('Upload error:', e);
            alert(`Network error uploading ${file.name}`);
        }
    }

    if (prog) prog.classList.add('hidden');
    input.value = '';
}

export function renderUploadedFiles() {
    const el = document.getElementById('uploaded-files-list');
    if (!el) return;
    const pendingFiles = getPendingFiles();
    const typeIcons = { syllabus: 'S', past_exam: 'E', notes: 'N', other: 'O' };

    const serverHtml = _serverFiles.map(f => `
        <div class="flex items-center gap-2 bg-dark-900/40 rounded-lg p-2" data-server-file-id="${f.id}">
            <span class="text-xs bg-mint-500/20 text-mint-400 px-1.5 py-0.5 rounded">${typeIcons[f.file_type] || 'O'}</span>
            <span class="text-sm flex-1 truncate">${f.filename}</span>
            <span class="text-xs text-white/30">${f.file_size ? (f.file_size / 1024).toFixed(0) + 'KB' : ''}</span>
            <button class="btn-delete-file text-xs text-white/20 hover:text-coral-400 transition-colors ml-1" data-file-id="${f.id}">✕</button>
        </div>
    `).join('');

    const pendingHtml = pendingFiles.map(f => `
        <div class="flex items-center gap-2 bg-dark-900/40 rounded-lg p-2" data-pending-file-id="${f.id}">
            <span class="text-xs bg-accent-500/20 text-accent-400 px-1.5 py-0.5 rounded">${typeIcons[f.file_type] || 'O'}</span>
            <span class="text-sm flex-1 truncate">${f.filename}</span>
            <span class="text-xs text-white/30">${(f.file_size / 1024).toFixed(0)}KB</span>
            <button class="btn-delete-file text-xs text-white/20 hover:text-coral-400 transition-colors ml-1" data-file-id="${f.id}">✕</button>
        </div>
    `).join('');

    el.innerHTML = serverHtml + pendingHtml;

    el.querySelectorAll('.btn-delete-file').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            deleteUploadedFile(parseInt(btn.dataset.fileId));
        };
    });
}

export async function deleteUploadedFile(fileId) {
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/exam-files/${fileId}`, { method: 'DELETE' });
        if (!res.ok) { alert('Failed to delete file'); return; }
        
        // Remove from persistent edit list
        _serverFiles = _serverFiles.filter(f => f.id !== fileId);
        
        // Remove from session pending list
        const pending = getPendingFiles().filter(f => f.id !== fileId);
        setPendingFiles(pending);
        
        renderUploadedFiles();
    } catch (e) {
        alert('Failed to delete file');
    }
}

// Module-level constant — same reference every time, removeEventListener always works
const _handleTaskToggle = (e) => { 
    const { taskId, btn, blockId } = e.detail; 
    toggleDone(taskId, btn, blockId); 
};

export function initTasks() {
    // Add exam buttons
    const btnAddExamTop = document.getElementById('btn-add-exam-top');
    if (btnAddExamTop) btnAddExamTop.onclick = openAddExamModal;

    // Generate roadmap button
    const btnGenerate = document.getElementById('btn-generate-roadmap');
    if (btnGenerate) btnGenerate.onclick = generateRoadmap;

    // Auditor review wizard buttons (3-step: Topics → Gaps → Tasks)
    const btnCancelReview = document.getElementById('btn-cancel-review');
    if (btnCancelReview) btnCancelReview.onclick = () => showScreen('screen-dashboard');

    const btnWizardNext1 = document.getElementById('btn-wizard-next-1');
    if (btnWizardNext1) btnWizardNext1.onclick = wizardGoToStep2;

    const btnWizardBack2 = document.getElementById('btn-wizard-back-2');
    if (btnWizardBack2) btnWizardBack2.onclick = wizardBackToStep1;

    const btnWizardNext2 = document.getElementById('btn-wizard-next-2');
    if (btnWizardNext2) btnWizardNext2.onclick = wizardGoToStep3;

    const btnWizardBack3 = document.getElementById('btn-wizard-back-3');
    if (btnWizardBack3) btnWizardBack3.onclick = wizardBackToStep2;

    const btnApproveSchedule = document.getElementById('btn-approve-schedule');
    if (btnApproveSchedule) btnApproveSchedule.onclick = approveSchedule;

    // Modal close buttons
    const btnCloseModal = document.getElementById('btn-close-exam-modal');
    if (btnCloseModal) btnCloseModal.onclick = closeAddExamModal;

    const btnCloseModal2 = document.getElementById('btn-close-exam-modal-2');
    if (btnCloseModal2) btnCloseModal2.onclick = closeAddExamModal;

    // Modal background click
    const modalBg = document.getElementById('modal-add-exam');
    if (modalBg) {
        modalBg.onclick = (e) => {
            if (e.target === modalBg) closeAddExamModal();
        };
    }

    // Modal step 2 button
    const btnStep2 = document.getElementById('btn-modal-to-step-2');
    if (btnStep2) btnStep2.onclick = modalToStep2;

    // File upload
    const fileInput = document.getElementById('exam-file-input');
    if (fileInput) fileInput.onchange = () => handleFileSelect(fileInput);

    // Skip and save buttons
    const btnSkipFiles = document.getElementById('btn-skip-files');
    if (btnSkipFiles) btnSkipFiles.onclick = async () => {
        const dateChanged = _editingExam?._dateChanged;
        closeAddExamModal();
        await loadExams();
        if (dateChanged) showRegenBar('Exam date changed — regenerate the schedule if needed.');
    };

    const btnSaveExam = document.getElementById('btn-save-exam');
    if (btnSaveExam) btnSaveExam.onclick = async () => {
        const dateChanged = _editingExam?._dateChanged;
        closeAddExamModal();
        await loadExams();
        if (dateChanged) showRegenBar('Exam date changed — regenerate the schedule if needed.');
    };

    // Notification permission modal
    const btnNotifYes = document.getElementById('btn-notif-yes');
    if (btnNotifYes) btnNotifYes.onclick = async () => {
        document.getElementById('modal-notif-permission')?.classList.remove('active');
        // Call the global requestNotificationPermission() which preserves the iOS
        // user-gesture context by calling Notification.requestPermission() directly.
        if (typeof window.requestNotificationPermission === 'function') {
            await window.requestNotificationPermission();
        }
    };

    const btnNotifNo = document.getElementById('btn-notif-no');
    if (btnNotifNo) btnNotifNo.onclick = () => {
        document.getElementById('modal-notif-permission')?.classList.remove('active');
    };

    // Module-level constant reference ensures removeEventListener always matches
    window.removeEventListener('task-toggle', _handleTaskToggle);
    window.addEventListener('task-toggle', _handleTaskToggle);

    window.removeEventListener('block-defer', _handleBlockDefer);
    window.addEventListener('block-defer', _handleBlockDefer);

    window.addEventListener('open-add-exam', () => openAddExamModal());
    window.addEventListener('trigger-generate-roadmap', () => generateRoadmap());
}

async function _handleBlockDefer(e) {
    const { blockId } = e.detail || {};
    if (blockId != null) await deferBlockToTomorrow(blockId);
}
