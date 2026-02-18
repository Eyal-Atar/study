/* StudyFlow — Main Application JS */

const API = window.location.origin;
let authToken = localStorage.getItem('studyflow_token');
let currentUser = null;
let currentExams = [];
let currentTasks = [];
// currentSchedule kept for compat but no longer used
let currentSchedule = [];
let pendingExamId = null;
let pendingFiles = [];

const EXAM_COLORS = ['accent', 'mint', 'coral', 'gold', 'sky'];
function examColor(idx) { return EXAM_COLORS[idx % EXAM_COLORS.length]; }
function examColorClass(idx, type) {
    const map = {
        accent: { bg: 'bg-accent-500', bg20: 'bg-accent-500/20', text: 'text-accent-400', border: 'border-accent-500/30' },
        mint:   { bg: 'bg-mint-500',   bg20: 'bg-mint-500/20',   text: 'text-mint-400',   border: 'border-mint-500/30' },
        coral:  { bg: 'bg-coral-500',  bg20: 'bg-coral-500/20',  text: 'text-coral-400',  border: 'border-coral-500/30' },
        gold:   { bg: 'bg-gold-500',   bg20: 'bg-gold-500/20',   text: 'text-gold-400',   border: 'border-gold-500/30' },
        sky:    { bg: 'bg-sky-500',    bg20: 'bg-sky-500/20',    text: 'text-sky-400',    border: 'border-sky-500/30' },
    };
    return map[examColor(idx)][type];
}

// ─── Auth helpers ─────────────────────────────────────
function authHeaders() {
    return authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
}
function authFetch(url, opts = {}) {
    opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
    return fetch(url, opts);
}

// ─── Screens ─────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

function shakeEl(id) {
    const el = document.getElementById(id);
    el.style.borderColor = '#F43F5E';
    el.style.animation = 'shake .4s ease';
    setTimeout(() => { el.style.borderColor = ''; el.style.animation = ''; }, 500);
}

function showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.classList.add('visible');
}
function hideError(id) {
    document.getElementById(id).classList.remove('visible');
}

// ─── Login ────────────────────────────────────────────
async function handleLogin() {
    hideError('login-error');
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email) { shakeEl('login-email'); return; }
    if (!password) { shakeEl('login-password'); return; }

    const btn = document.getElementById('btn-login');
    btn.disabled = true; btn.textContent = 'Logging in...';
    try {
        const res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
            showError('login-error', data.detail || 'Login failed');
            return;
        }
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('studyflow_token', authToken);
        initDashboard();
        showScreen('screen-dashboard');
    } catch (e) {
        showError('login-error', 'Cannot connect to server');
    } finally {
        btn.disabled = false; btn.textContent = 'Log In';
    }
}

// ─── Register ─────────────────────────────────────────
function regNext(step) {
    if (step === 2) {
        hideError('reg-error-1');
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
        if (!name) { shakeEl('reg-name'); return; }
        if (!email || !email.includes('@')) { shakeEl('reg-email'); showError('reg-error-1', 'Valid email required'); return; }
        if (password.length < 6) { shakeEl('reg-password'); showError('reg-error-1', 'Password must be at least 6 characters'); return; }
    }
    for (let i = 1; i <= 3; i++) document.getElementById(`reg-step-${i}`).style.display = i === step ? 'block' : 'none';
    for (let i = 1; i <= 3; i++) {
        document.getElementById(`reg-dot-${i}`).className = `w-2.5 h-2.5 rounded-full transition-all ${i <= step ? 'bg-accent-500' : 'bg-white/20'}`;
    }
}

async function handleRegister() {
    hideError('reg-error-3');
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const method = document.querySelector('input[name="reg-method"]:checked').value;
    const wake = document.getElementById('reg-wake').value;
    const sleep = document.getElementById('reg-sleep').value;

    const btn = document.getElementById('btn-register');
    btn.disabled = true; btn.textContent = 'Creating...';
    try {
        const res = await fetch(`${API}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name, email, password,
                study_method: method,
                wake_up_time: wake,
                sleep_time: sleep,
                session_minutes: method === 'pomodoro' ? 50 : 90,
                break_minutes: method === 'pomodoro' ? 10 : 15,
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            showError('reg-error-3', data.detail || 'Registration failed');
            return;
        }
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('studyflow_token', authToken);
        initDashboard();
        showScreen('screen-dashboard');
    } catch (e) {
        showError('reg-error-3', 'Cannot connect to server');
    } finally {
        btn.disabled = false; btn.textContent = 'Create Account';
    }
}

// ─── Logout ───────────────────────────────────────────
async function handleLogout() {
    try { await authFetch(`${API}/auth/logout`, { method: 'POST' }); } catch (e) {}
    authToken = null;
    currentUser = null;
    currentExams = [];
    currentTasks = [];
    currentSchedule = [];
    localStorage.removeItem('studyflow_token');
    showScreen('screen-welcome');
}

// ─── Dashboard Init ──────────────────────────────────
function initDashboard() {
    document.getElementById('user-greeting').textContent = `Hey, ${currentUser.name}`;
    document.getElementById('user-avatar').textContent = currentUser.name[0].toUpperCase();
    loadExams();
}

async function loadExams() {
    try {
        const res = await authFetch(`${API}/exams`);
        if (!res.ok) { if (res.status === 401) { handleLogout(); return; } return; }
        currentExams = await res.json();
        renderExamCards();
        updateStats();
        renderExamLegend();
        const tres = await authFetch(`${API}/tasks`);
        if (tres.ok) {
            currentTasks = await tres.json();
            updateStats();
            renderCalendar(currentTasks);
            renderTodayFocus(currentTasks);
        }
    } catch (e) { console.error(e); }
}

function renderExamCards() {
    const container = document.getElementById('exam-cards');
    if (currentExams.length === 0) {
        container.innerHTML = `
            <div class="fade-in flex-shrink-0 w-48 h-36 rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-accent-500/50 transition-colors" onclick="openAddExamModal()">
                <div class="text-2xl mb-1 opacity-40">+</div>
                <div class="text-sm text-white/30">Add your first exam</div>
            </div>`;
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
            <button onclick="event.stopPropagation();deleteExam(${exam.id})" class="mt-2 text-xs text-white/20 hover:text-coral-400 transition-colors">Delete</button>
        </div>`;
    });
    html += `
    <div class="fade-in flex-shrink-0 w-36 h-36 rounded-2xl border-2 border-dashed border-white/10 flex flex-col items-center justify-center cursor-pointer hover:border-accent-500/50 transition-colors" onclick="openAddExamModal()">
        <div class="text-2xl mb-1 opacity-40">+</div>
        <div class="text-xs text-white/30">Add Exam</div>
    </div>`;
    container.innerHTML = html;
}

function renderExamLegend() {
    const el = document.getElementById('exam-legend');
    if (currentExams.length === 0) { el.innerHTML = '<p class="text-white/30 text-sm">Add exams to see legend</p>'; return; }
    el.innerHTML = currentExams.map((exam, i) => `
        <div class="flex items-center gap-2">
            <div class="w-3 h-3 rounded-full ${examColorClass(i,'bg')}"></div>
            <span class="text-sm text-white/60">${exam.name}</span>
        </div>
    `).join('');
}

function updateStats() {
    const pending = currentTasks.filter(t => t.status !== 'done');
    const done = currentTasks.filter(t => t.status === 'done');
    const hours = pending.reduce((s, t) => s + t.estimated_hours, 0);
    document.getElementById('stat-exams').textContent = currentExams.length;
    document.getElementById('stat-hours').textContent = hours.toFixed(1) + 'h';
    document.getElementById('stat-done').textContent = `${done.length}/${currentTasks.length}`;
    const upcoming = currentExams.filter(e => new Date(e.exam_date) >= new Date());
    if (upcoming.length > 0) {
        const nearest = upcoming.sort((a, b) => new Date(a.exam_date) - new Date(b.exam_date))[0];
        const days = Math.ceil((new Date(nearest.exam_date) - new Date()) / 86400000);
        document.getElementById('stat-days').textContent = days;
        document.getElementById('stat-days-label').textContent = `days · ${nearest.subject}`;
    }
}

// ─── Add Exam Modal ──────────────────────────────────
function openAddExamModal() {
    document.getElementById('modal-add-exam').classList.add('active');
    document.getElementById('modal-step-1').style.display = 'block';
    document.getElementById('modal-step-2').style.display = 'none';
    document.getElementById('exam-name').value = '';
    document.getElementById('exam-subject').value = '';
    document.getElementById('exam-date').value = '';
    document.getElementById('exam-needs').value = '';
    pendingExamId = null;
    pendingFiles = [];
    document.getElementById('uploaded-files-list').innerHTML = '';
    setTimeout(() => document.getElementById('exam-name').focus(), 100);
}

function closeAddExamModal() {
    document.getElementById('modal-add-exam').classList.remove('active');
}

async function modalToStep2() {
    const name = document.getElementById('exam-name').value.trim();
    const subject = document.getElementById('exam-subject').value.trim();
    const date = document.getElementById('exam-date').value;
    if (!name) { shakeEl('exam-name'); return; }
    if (!subject) { shakeEl('exam-subject'); return; }
    if (!date) { shakeEl('exam-date'); return; }
    try {
        const res = await authFetch(`${API}/exams`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, subject, exam_date: date, special_needs: document.getElementById('exam-needs').value.trim() || null }),
        });
        const exam = await res.json();
        if (!res.ok) { alert(exam.detail || 'Failed'); return; }
        pendingExamId = exam.id;
        document.getElementById('modal-exam-title').textContent = `Files for: ${name}`;
        document.getElementById('modal-step-1').style.display = 'none';
        document.getElementById('modal-step-2').style.display = 'block';
    } catch (e) { alert('Failed to create exam'); }
}

async function handleFileSelect(input) {
    const file = input.files[0];
    if (!file || !pendingExamId) return;
    const fileType = document.getElementById('file-type-select').value;
    const prog = document.getElementById('upload-progress');
    prog.classList.remove('hidden');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('file_type', fileType);
    try {
        const res = await authFetch(`${API}/exams/${pendingExamId}/upload`, { method: 'POST', body: formData });
        const data = await res.json();
        pendingFiles.push(data);
        renderUploadedFiles();
    } catch (e) { alert('Upload failed'); }
    prog.classList.add('hidden');
    input.value = '';
}

function renderUploadedFiles() {
    const el = document.getElementById('uploaded-files-list');
    const typeIcons = { syllabus: 'S', past_exam: 'E', notes: 'N', other: 'O' };
    el.innerHTML = pendingFiles.map(f => `
        <div class="flex items-center gap-2 bg-dark-900/40 rounded-lg p-2">
            <span class="text-xs bg-accent-500/20 text-accent-400 px-1.5 py-0.5 rounded">${typeIcons[f.file_type] || 'O'}</span>
            <span class="text-sm flex-1 truncate">${f.filename}</span>
            <span class="text-xs text-white/30">${(f.file_size / 1024).toFixed(0)}KB</span>
        </div>
    `).join('');
}

async function skipFilesAndSave() { closeAddExamModal(); await loadExams(); }
async function saveExamWithFiles() { closeAddExamModal(); await loadExams(); }

async function deleteExam(examId) {
    if (!confirm('Delete this exam and all its files?')) return;
    await authFetch(`${API}/exams/${examId}`, { method: 'DELETE' });
    await loadExams();
    if (currentExams.length === 0) {
        currentTasks = [];
        renderCalendar([]);
    }
}

// ─── Generate Roadmap ────────────────────────────────
async function generateRoadmap() {
    if (currentExams.length === 0) { alert('Add exams first!'); return; }
    const overlay = document.getElementById('loading-overlay');
    overlay.classList.add('active');
    try {
        const res = await authFetch(`${API}/generate-roadmap`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) { alert(data.detail || 'Failed to generate roadmap'); return; }
        currentTasks = data.tasks;
        await loadExams();
        renderCalendar(currentTasks);
        renderTodayFocus(currentTasks);
        updateStats();
    } catch (e) {
        console.error(e);
        alert('Failed to generate roadmap. Check server logs.');
    } finally {
        overlay.classList.remove('active');
    }
}

// ─── Calendar Rendering ─────────────────────────────
function renderCalendar(tasks) {
    const container = document.getElementById('roadmap-container');
    if (!tasks || tasks.length === 0) {
        container.innerHTML = `
            <div class="absolute left-[15px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-accent-500 via-mint-400 to-gold-400 opacity-20"></div>
            <div class="text-center py-12 text-white/30"><p class="text-lg">No calendar generated yet</p></div>`;
        return;
    }
    const examIdx = {};
    currentExams.forEach((e, i) => { examIdx[e.id] = i; });

    // Group tasks by day_date
    const days = {};
    tasks.forEach(task => {
        const day = task.day_date || task.deadline || 'unscheduled';
        if (!days[day]) days[day] = [];
        days[day].push(task);
    });
    // Sort activities within each day
    Object.values(days).forEach(arr => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));

    const dayKeys = Object.keys(days).filter(d => d !== 'unscheduled').sort();
    const today = new Date().toISOString().split('T')[0];
    const examDateSet = {};
    currentExams.forEach((e, i) => { examDateSet[e.exam_date] = { name: e.name, idx: i }; });

    let html = '<div class="absolute left-[15px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-accent-500 via-mint-400 to-gold-400 opacity-20"></div>';
    dayKeys.forEach(day => {
        const dayTasks = days[day];
        const isToday = day === today;
        const isPast = day < today;
        const date = new Date(day + 'T00:00:00');
        const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
        const dayNum = date.getDate();
        const monthName = date.toLocaleDateString('en-US', { month: 'short' });
        const examOnDay = examDateSet[day];
        const isExamDay = dayTasks.some(t => t.title && t.title.startsWith('EXAM DAY'));

        // Subject focus badge — find dominant subject
        const subjects = dayTasks.map(t => t.subject).filter(Boolean);
        const subjectFocus = subjects.length > 0 ? subjects[0] : null;

        // Check if close to exam (exclusive zone)
        let zoneExam = null;
        const uniqueExams = [...new Set(dayTasks.map(t => t.exam_id).filter(Boolean))];
        if (uniqueExams.length === 1 && !isExamDay) {
            const eid = uniqueExams[0];
            const exam = currentExams.find(e => e.id === eid);
            if (exam) {
                const daysUntilExam = Math.ceil((new Date(exam.exam_date) - date) / 86400000);
                if (daysUntilExam <= 4 && daysUntilExam > 0) zoneExam = exam;
            }
        }

        html += `<div class="fade-in relative mb-5 ${isPast ? 'opacity-50' : ''}">
            <div class="absolute -left-8 top-1 w-[14px] h-[14px] rounded-full border-2
                ${isToday ? 'border-accent-400 bg-accent-500 node-pulse' : isPast ? 'border-mint-400/50 bg-mint-500/50' : isExamDay || examOnDay ? 'border-gold-400 bg-gold-500' : 'border-white/20 bg-dark-700'}
            "></div>
            <div class="flex items-center gap-2 mb-2 flex-wrap">
                <span class="text-sm font-bold ${isToday ? 'text-accent-400' : isExamDay || examOnDay ? 'text-gold-400' : 'text-white/50'}">${isToday ? 'TODAY' : dayName}</span>
                <span class="text-xs text-white/30">${monthName} ${dayNum}</span>
                ${isToday ? '<span class="text-xs bg-accent-500/20 text-accent-400 px-2 py-0.5 rounded-full">Active</span>' : ''}
                ${subjectFocus && !isExamDay ? `<span class="text-xs bg-dark-900/50 text-white/50 px-2 py-0.5 rounded-full">${subjectFocus}</span>` : ''}
                ${zoneExam ? `<span class="text-xs bg-coral-500/20 text-coral-400 px-2 py-0.5 rounded-full">Focus: ${zoneExam.name}</span>` : ''}
            </div>`;

        // Exam day milestone
        if (isExamDay || examOnDay) {
            const idx = examOnDay ? examOnDay.idx : (examIdx[dayTasks[0].exam_id] ?? 0);
            const examName = examOnDay ? examOnDay.name : (dayTasks[0].title.replace('EXAM DAY: ', ''));
            html += `<div class="mb-2 px-3 py-2 rounded-xl ${examColorClass(idx,'bg20')} border ${examColorClass(idx,'border')}">
                <span class="text-sm font-bold ${examColorClass(idx,'text')}">EXAM: ${examName}</span>
            </div>`;
        }

        // Activity cards
        const activities = isExamDay ? dayTasks.filter(t => !t.title.startsWith('EXAM DAY')) : dayTasks;
        if (activities.length > 0) {
            const totalHours = activities.reduce((s, t) => s + (t.estimated_hours || 0), 0);
            html += '<div class="space-y-1.5 ml-1">';
            activities.forEach(task => {
                const eIdx = examIdx[task.exam_id] ?? 0;
                const isDone = task.status === 'done';
                const diffDots = task.difficulty > 0 ? '●'.repeat(Math.min(task.difficulty, 5)) + '○'.repeat(Math.max(0, 5 - task.difficulty)) : '';
                html += `
                <div class="card-hover bg-dark-600/60 rounded-xl p-3 border border-white/5 flex items-center gap-3 ${isDone ? 'opacity-40' : ''}">
                    <button onclick="toggleDone(${task.id},this)" class="flex-shrink-0 w-6 h-6 rounded-full border-2 ${isDone ? 'bg-mint-500 border-mint-500' : 'border-white/20 hover:border-accent-400'} flex items-center justify-center transition-all">
                        ${isDone ? '<svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
                    </button>
                    <div class="w-2.5 h-8 rounded-full ${examColorClass(eIdx,'bg')} flex-shrink-0"></div>
                    <div class="flex-1 min-w-0">
                        <div class="font-medium text-sm ${isDone ? 'line-through text-white/40' : ''} truncate">${task.title}</div>
                        <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                            ${task.topic ? `<span class="text-xs ${examColorClass(eIdx,'text')}">${task.topic}</span>` : ''}
                            ${task.estimated_hours ? `<span class="text-xs text-white/30">${task.estimated_hours}h</span>` : ''}
                            ${diffDots ? `<span class="text-xs text-white/20">${diffDots}</span>` : ''}
                        </div>
                    </div>
                </div>`;
            });
            if (totalHours > 0) {
                html += `<div class="text-right text-xs text-white/20 mt-1 mr-1">${totalHours.toFixed(1)}h total</div>`;
            }
            html += '</div>';
        }
        html += '</div>';
    });
    container.innerHTML = html;
}

function renderTodayFocus(tasks) {
    const el = document.getElementById('today-tasks');
    const today = new Date().toISOString().split('T')[0];
    const todayTasks = tasks.filter(t => t.day_date === today && t.status !== 'done');
    if (!todayTasks.length) { el.innerHTML = '<p class="text-white/30 text-sm">No tasks for today</p>'; return; }
    const examIdx = {};
    currentExams.forEach((e, i) => { examIdx[e.id] = i; });
    el.innerHTML = todayTasks.map(t => {
        const eIdx = examIdx[t.exam_id] ?? 0;
        return `<div class="flex items-center gap-2 bg-dark-900/40 rounded-lg p-2.5">
            <div class="w-2.5 h-2.5 rounded-full ${examColorClass(eIdx,'bg')}"></div>
            <div class="flex-1 text-sm truncate">${t.title}</div>
            <div class="text-xs text-white/30">${t.estimated_hours || 0}h</div>
        </div>`;
    }).join('');
}

// ─── Task Actions ────────────────────────────────────
async function toggleDone(taskId, btn) {
    const task = currentTasks.find(t => t.id === taskId);
    if (!task) return;
    const isDone = task.status === 'done';
    try {
        await authFetch(`${API}/tasks/${taskId}/${isDone ? 'undone' : 'done'}`, { method: 'PATCH' });
        task.status = isDone ? 'pending' : 'done';
        if (!isDone) spawnConfetti(btn);
        updateStats();
        renderCalendar(currentTasks);
        renderTodayFocus(currentTasks);
        await loadExams();
    } catch (e) { console.error(e); }
}

function spawnConfetti(origin) {
    const rect = origin.getBoundingClientRect();
    const colors = ['#6B47F5', '#10B981', '#FBBF24', '#F43F5E', '#38BDF8'];
    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = rect.left + rect.width / 2 + (Math.random() - .5) * 60 + 'px';
        p.style.top = rect.top + 'px';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1500);
    }
}

// ─── Brain Chat ──────────────────────────────────────
let brainChatHistory = [];
async function sendBrainMessage() {
    const input = document.getElementById('brain-input');
    const msg = input.value.trim();
    if (!msg || !currentUser) return;
    input.value = '';
    const loading = document.getElementById('brain-loading');
    const btn = document.getElementById('btn-brain-send');
    addChatBubble('user', msg);
    loading.classList.remove('hidden');
    btn.disabled = true; btn.style.opacity = '0.5';
    try {
        const res = await authFetch(`${API}/brain-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg }),
        });
        const data = await res.json();
        if (!res.ok) { addChatBubble('brain', data.detail || 'Something went wrong'); return; }
        addChatBubble('brain', data.brain_reply);
        currentTasks = data.tasks;
        await loadExams();
        renderCalendar(currentTasks);
        renderTodayFocus(currentTasks);
        updateStats();
    } catch (e) {
        addChatBubble('brain', 'Failed to reach the brain. Check server.');
    } finally {
        loading.classList.add('hidden');
        btn.disabled = false; btn.style.opacity = '1';
    }
}

function addChatBubble(role, text) {
    const container = document.getElementById('brain-chat-history');
    const isUser = role === 'user';
    const bubble = document.createElement('div');
    bubble.className = `flex ${isUser ? 'justify-end' : 'justify-start'}`;
    bubble.innerHTML = `
        <div class="max-w-[85%] rounded-xl px-3 py-2 text-sm ${isUser ? 'bg-accent-500/20 text-accent-400' : 'bg-dark-900/60 text-white/70'}">
            ${isUser ? '' : '<span class="text-xs font-medium text-mint-400 block mb-0.5">Brain</span>'}
            ${text}
        </div>`;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    brainChatHistory.push({ role, text });
}

// ─── Init ────────────────────────────────────────────
(async function () {
    if (!authToken) return;
    try {
        const res = await fetch(`${API}/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        if (!res.ok) throw new Error('Not authenticated');
        currentUser = await res.json();
        initDashboard();
        showScreen('screen-dashboard');
    } catch (e) {
        localStorage.removeItem('studyflow_token');
        authToken = null;
    }
})();
