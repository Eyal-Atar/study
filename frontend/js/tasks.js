import { getAPI, authFetch, getCurrentExams, setCurrentExams, getCurrentTasks, setCurrentTasks, getCurrentSchedule, setCurrentSchedule, getPendingExamId, setPendingExamId, getPendingFiles, setPendingFiles, setLatestAiDebug } from './store.js?v=AUTO';
import { shakeEl, spawnConfetti, examColorClass, showModal, showConfirmModal } from './ui.js?v=AUTO';
import { renderCalendar, renderFocus, renderExamLegend } from './calendar.js?v=AUTO';
import { showRegenBar, hideRegenBar } from './brain.js?v=AUTO';

// Notification permission prompt tracking
const NOTIF_PROMPT_KEY = 'sf_notif_prompt_shown';

function hasShownNotifPrompt() {
    return localStorage.getItem(NOTIF_PROMPT_KEY) === '1';
}
function markNotifPromptShown() {
    localStorage.setItem(NOTIF_PROMPT_KEY, '1');
}

// Track edit mode: null = add mode, exam object = edit mode
let _editingExam = null;
// Existing server files loaded for the exam being edited
let _serverFiles = [];

/** Full refresh from server (tasks + schedule + exams). Use after defer or when sync might be off. */
export async function refreshScheduleAndFocus() {
    const API = getAPI();
    try {
        const tres = await authFetch(`${API}/regenerate-schedule`, { method: 'POST' });
        if (!tres.ok) return;
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
    } catch (e) {
        console.error('refreshScheduleAndFocus:', e);
    }
}

/** After a single block/task toggle we already have correct state in memory. Only sync task status from blocks and refresh Focus + exam stats (no full calendar refetch). */
function syncAfterToggle(taskId, isBlockToggle) {
    if (isBlockToggle) {
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

export async function loadExams(onLogout) {
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
        
        const tres = await authFetch(`${API}/regenerate-schedule`, { method: 'POST' });
        if (tres.ok) {
            const data = await tres.json();
            setCurrentTasks(data.tasks);
            setCurrentSchedule(data.schedule);
            updateStats();
            renderCalendar(data.tasks, data.schedule);
            renderFocus(data.tasks);
        }
    } catch (e) {
        console.error(e);
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
    setStatEl('stat-done', `${done.length}/${currentTasks.length}`);

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
    const task = currentTasks.find(t => t.id === taskId);
    if (!task) {
        _togglingTasks.delete(lockKey);
        return;
    }

    const block = isBlockToggle ? currentSchedule.find(b => b.id === blockId) : null;
    const isDone = isBlockToggle ? (block?.completed === 1) : (task.status === 'done');
    const API = getAPI();
    
    // Optimistic Update
    if (isBlockToggle && block) {
        block.completed = isDone ? 0 : 1;
    } else {
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
            if (b.task_id === taskId) b.completed = isDone ? 1 : 0;
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

        // We already updated DOM and store; only sync task status from blocks and refresh Focus + exam stats (no full refetch)
        syncAfterToggle(taskId, isBlockToggle);
    } catch (e) {
        console.error("Sync failed:", e);
        // Rollback optimistic update
        if (isBlockToggle && block) {
            block.completed = isDone ? 1 : 0;
        } else {
            task.status = isDone ? 'done' : 'pending';
            (currentSchedule || []).forEach(b => {
                if (b.task_id === taskId) b.completed = isDone ? 0 : 1;
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
    
    showModal('loading-overlay', true);
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/generate-roadmap`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
            alert(data.detail || 'Failed to generate roadmap');
            return;
        }
        
        if (data.debug) {
            setLatestAiDebug({
                prompt: data.debug.prompt || '',
                response: data.debug.raw_response || ''
            });
        }
        
        await loadExams(); // This will now fetch full schedule and render it
        hideRegenBar();
    } catch (e) {
        alert('Failed to generate roadmap. Check server logs.');
    } finally {
        showModal('loading-overlay', false);
    }
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
    document.getElementById('exam-needs').value = '';
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
    document.getElementById('exam-needs').value = exam.special_needs || '';
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
                    special_needs: document.getElementById('exam-needs').value.trim() || null
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
                    special_needs: document.getElementById('exam-needs').value.trim() || null
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
    const file = input.files[0];
    const pendingExamId = getPendingExamId();
    if (!file || !pendingExamId) return;
    
    const fileType = document.getElementById('file-type-select').value;
    const prog = document.getElementById('upload-progress');
    if (prog) prog.classList.remove('hidden');
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('file_type', fileType);
    
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/exams/${pendingExamId}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        const files = getPendingFiles();
        files.push(data);
        setPendingFiles(files);
        renderUploadedFiles();
    } catch (e) {
        alert('Upload failed');
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
            <button class="btn-delete-server-file text-xs text-white/20 hover:text-coral-400 transition-colors ml-1" data-file-id="${f.id}">✕</button>
        </div>
    `).join('');

    const pendingHtml = pendingFiles.map(f => `
        <div class="flex items-center gap-2 bg-dark-900/40 rounded-lg p-2">
            <span class="text-xs bg-accent-500/20 text-accent-400 px-1.5 py-0.5 rounded">${typeIcons[f.file_type] || 'O'}</span>
            <span class="text-sm flex-1 truncate">${f.filename}</span>
            <span class="text-xs text-white/30">${(f.file_size / 1024).toFixed(0)}KB</span>
        </div>
    `).join('');

    el.innerHTML = serverHtml + pendingHtml;

    el.querySelectorAll('.btn-delete-server-file').forEach(btn => {
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
        _serverFiles = _serverFiles.filter(f => f.id !== fileId);
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
