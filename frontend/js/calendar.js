import { getCurrentExams } from './store.js';
import { examColorClass } from './ui.js';

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

export function renderCalendar(tasks) {
    const container = document.getElementById('roadmap-container');
    if (!container) return;
    if (!tasks || tasks.length === 0) {
        container.innerHTML = `
            <div class="absolute left-[15px] top-0 bottom-0 w-[2px] bg-gradient-to-b from-accent-500 via-mint-400 to-gold-400 opacity-20"></div>
            <div class="text-center py-12 text-white/30"><p class="text-lg">No calendar generated yet</p></div>`;
        return;
    }
    
    const currentExams = getCurrentExams();
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
                    <button data-task-id="${task.id}" class="btn-toggle-done flex-shrink-0 w-6 h-6 rounded-full border-2 ${isDone ? 'bg-mint-500 border-mint-500' : 'border-white/20 hover:border-accent-400'} flex items-center justify-center transition-all">
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

    // We can't bind toggleDone here because of circular dependency if we import it.
    // Instead, we will dispatch a custom event or let tasks.js handle it.
    // Given the current structure, let's use a custom event.
    container.querySelectorAll('.btn-toggle-done').forEach(btn => {
        btn.onclick = () => {
            const event = new CustomEvent('task-toggle', { 
                detail: { taskId: parseInt(btn.dataset.taskId), btn: btn } 
            });
            window.dispatchEvent(event);
        };
    });
}

export function renderTodayFocus(tasks) {
    const el = document.getElementById('today-tasks');
    if (!el) return;
    const today = new Date().toISOString().split('T')[0];
    const todayTasks = tasks.filter(t => t.day_date === today && t.status !== 'done');
    if (!todayTasks.length) { 
        el.innerHTML = '<p class="text-white/30 text-sm">No tasks for today</p>'; 
        return; 
    }
    const currentExams = getCurrentExams();
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
