import { getAPI, authFetch, getCurrentUser, setCurrentTasks, getBrainChatHistory, setBrainChatHistory } from './store.js';
import { loadExams, updateStats } from './tasks.js';
import { renderCalendar, renderTodayFocus } from './calendar.js';

export async function sendBrainMessage() {
    const input = document.getElementById('brain-input');
    if (!input) return;
    const msg = input.value.trim();
    const currentUser = getCurrentUser();
    if (!msg || !currentUser) return;
    
    input.value = '';
    const loading = document.getElementById('brain-loading');
    const btn = document.getElementById('btn-brain-send');
    
    addChatBubble('user', msg);
    if (loading) loading.classList.remove('hidden');
    if (btn) {
        btn.disabled = true; 
        btn.style.opacity = '0.5';
    }
    
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/brain-chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg }),
        });
        const data = await res.json();
        if (!res.ok) { 
            addChatBubble('brain', data.detail || 'Something went wrong'); 
            return; 
        }
        addChatBubble('brain', data.brain_reply);
        setCurrentTasks(data.tasks);
        await loadExams();
        renderCalendar(data.tasks);
        renderTodayFocus(data.tasks);
        updateStats();
    } catch (e) {
        addChatBubble('brain', 'Failed to reach the brain. Check server.');
    } finally {
        if (loading) loading.classList.add('hidden');
        if (btn) {
            btn.disabled = false; 
            btn.style.opacity = '1';
        }
    }
}

export function addChatBubble(role, text) {
    const container = document.getElementById('brain-chat-history');
    if (!container) return;
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
    
    const history = getBrainChatHistory();
    history.push({ role, text });
    setBrainChatHistory(history);
}

export function initBrain() {
    const btnSend = document.getElementById('btn-brain-send');
    if (btnSend) btnSend.onclick = sendBrainMessage;

    const input = document.getElementById('brain-input');
    if (input) {
        input.onkeydown = (e) => {
            if (e.key === 'Enter') sendBrainMessage();
        };
    }
}
