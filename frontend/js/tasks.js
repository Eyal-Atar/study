import { getAPI, authFetch, getCurrentExams, setCurrentExams, getCurrentTasks, setCurrentTasks, getPendingExamId, setPendingExamId, getPendingFiles, setPendingFiles } from './store.js';
import { shakeEl, spawnConfetti, examColorClass } from './ui.js';
import { renderCalendar, renderTodayFocus, renderExamLegend } from './calendar.js';

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
        
        const tres = await authFetch(`${API}/tasks`);
        if (tres.ok) {
            const tasks = await tres.json();
            setCurrentTasks(tasks);
            updateStats();
            renderCalendar(tasks);
            renderTodayFocus(tasks);
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
            <button data-exam-id="${exam.id}" class="btn-delete-exam mt-2 text-xs text-white/20 hover:text-coral-400 transition-colors">Delete</button>
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

    container.querySelectorAll('.btn-delete-exam').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            deleteExam(btn.dataset.examId);
        };
    });
}

export function updateStats() {
    const currentExams = getCurrentExams();
    const currentTasks = getCurrentTasks();
    
    const pending = currentTasks.filter(t => t.status !== 'done');
    const done = currentTasks.filter(t => t.status === 'done');
    const hours = pending.reduce((s, t) => s + t.estimated_hours, 0);

    const elExams = document.getElementById('stat-exams');
    const elHours = document.getElementById('stat-hours');
    const elDone = document.getElementById('stat-done');
    const elDays = document.getElementById('stat-days');
    const elDaysLabel = document.getElementById('stat-days-label');

    if (elExams) elExams.textContent = currentExams.length;
    if (elHours) elHours.textContent = hours.toFixed(1) + 'h';
    if (elDone) elDone.textContent = `${done.length}/${currentTasks.length}`;
    
    const upcoming = currentExams.filter(e => new Date(e.exam_date) >= new Date());
    if (upcoming.length > 0 && elDays && elDaysLabel) {
        const nearest = upcoming.sort((a, b) => new Date(a.exam_date) - new Date(b.exam_date))[0];
        const days = Math.ceil((new Date(nearest.exam_date) - new Date()) / 86400000);
        elDays.textContent = days;
        elDaysLabel.textContent = `days · ${nearest.subject}`;
    }
}

export async function deleteExam(examId) {
    if (!confirm('Delete this exam and all its files?')) return;
    const API = getAPI();
    await authFetch(`${API}/exams/${examId}`, { method: 'DELETE' });
    await loadExams();
    const currentExams = getCurrentExams();
    if (currentExams.length === 0) {
        setCurrentTasks([]);
        renderCalendar([]);
    }
}

export async function toggleDone(taskId, btn) {
    const currentTasks = getCurrentTasks();
    const task = currentTasks.find(t => t.id === taskId);
    if (!task) return;
    const isDone = task.status === 'done';
    const API = getAPI();
    try {
        await authFetch(`${API}/tasks/${taskId}/${isDone ? 'undone' : 'done'}`, { method: 'PATCH' });
        task.status = isDone ? 'pending' : 'done';
        if (!isDone) spawnConfetti(btn);
        updateStats();
        renderCalendar(currentTasks);
        renderTodayFocus(currentTasks);
        await loadExams();
    } catch (e) {
        console.error(e);
    }
}

export async function generateRoadmap() {
    const currentExams = getCurrentExams();
    if (currentExams.length === 0) {
        alert('Add exams first!');
        return;
    }
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('active');
    
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/generate-roadmap`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) {
            alert(data.detail || 'Failed to generate roadmap');
            return;
        }
        setCurrentTasks(data.tasks);
        await loadExams();
        renderCalendar(data.tasks);
        renderTodayFocus(data.tasks);
        updateStats();
    } catch (e) {
        console.error(e);
        alert('Failed to generate roadmap. Check server logs.');
    } finally {
        if (overlay) overlay.classList.remove('active');
    }
}

// ─── Add Exam Modal Logic ────────────────────────────

export function openAddExamModal() {
    const modal = document.getElementById('modal-add-exam');
    if (!modal) return;
    modal.classList.add('active');
    document.getElementById('modal-step-1').style.display = 'block';
    document.getElementById('modal-step-2').style.display = 'none';
    document.getElementById('exam-name').value = '';
    document.getElementById('exam-subject').value = '';
    document.getElementById('exam-date').value = '';
    document.getElementById('exam-needs').value = '';
    setPendingExamId(null);
    setPendingFiles([]);
    document.getElementById('uploaded-files-list').innerHTML = '';
    setTimeout(() => document.getElementById('exam-name').focus(), 100);
}

export function closeAddExamModal() {
    const modal = document.getElementById('modal-add-exam');
    if (modal) modal.classList.remove('active');
}

async function modalToStep2() {
    const name = document.getElementById('exam-name').value.trim();
    const subject = document.getElementById('exam-subject').value.trim();
    const date = document.getElementById('exam-date').value;
    if (!name) { shakeEl('exam-name'); return; }
    if (!subject) { shakeEl('exam-subject'); return; }
    if (!date) { shakeEl('exam-date'); return; }
    
    const API = getAPI();
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
        document.getElementById('modal-exam-title').textContent = `Files for: ${name}`;
        document.getElementById('modal-step-1').style.display = 'none';
        document.getElementById('modal-step-2').style.display = 'block';
    } catch (e) {
        alert('Failed to create exam');
    }
}

async function handleFileSelect(input) {
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

function renderUploadedFiles() {
    const el = document.getElementById('uploaded-files-list');
    if (!el) return;
    const pendingFiles = getPendingFiles();
    const typeIcons = { syllabus: 'S', past_exam: 'E', notes: 'N', other: 'O' };
    el.innerHTML = pendingFiles.map(f => `
        <div class="flex items-center gap-2 bg-dark-900/40 rounded-lg p-2">
            <span class="text-xs bg-accent-500/20 text-accent-400 px-1.5 py-0.5 rounded">${typeIcons[f.file_type] || 'O'}</span>
            <span class="text-sm flex-1 truncate">${f.filename}</span>
            <span class="text-xs text-white/30">${(f.file_size / 1024).toFixed(0)}KB</span>
        </div>
    `).join('');
}

export function initTasks() {
    const btnGenerate = document.getElementById('btn-generate-roadmap');
    if (btnGenerate) btnGenerate.onclick = generateRoadmap;

    const btnCloseModal = document.getElementById('btn-close-exam-modal');
    if (btnCloseModal) btnCloseModal.onclick = closeAddExamModal;

    const btnStep2 = document.getElementById('btn-modal-to-step-2');
    if (btnStep2) btnStep2.onclick = modalToStep2;

    const fileInput = document.getElementById('exam-file-input');
    if (fileInput) fileInput.onchange = () => handleFileSelect(fileInput);

    const btnSkipFiles = document.getElementById('btn-skip-files');
    if (btnSkipFiles) btnSkipFiles.onclick = async () => { closeAddExamModal(); await loadExams(); };

    const btnSaveExam = document.getElementById('btn-save-exam');
    if (btnSaveExam) btnSaveExam.onclick = async () => { closeAddExamModal(); await loadExams(); };

    window.addEventListener('task-toggle', (e) => {
        const { taskId, btn } = e.detail;
        toggleDone(taskId, btn);
    });
}
