import { getAPI, authFetch, setRegenTriggered, setCurrentTasks, setCurrentSchedule } from './store.js?v=22';
import { renderCalendar, renderTodayFocus } from './calendar.js?v=24';
import { updateStats } from './tasks.js?v=24';

/**
 * Show or hide the regeneration command bar.
 * Called whenever a constraint changes (exam date updated, study hours changed).
 */
export function showRegenBar(label) {
    const bar = document.getElementById('regen-command-bar');
    const triggerLabel = document.getElementById('regen-trigger-label');
    if (!bar) return;
    if (label && triggerLabel) triggerLabel.textContent = label;
    bar.classList.remove('hidden');
    // Clear previous result
    const result = document.getElementById('regen-result');
    if (result) { result.classList.add('hidden'); result.textContent = ''; }
    // Focus the textarea
    const input = document.getElementById('regen-input');
    if (input) setTimeout(() => input.focus(), 100);
}

export function hideRegenBar() {
    const bar = document.getElementById('regen-command-bar');
    if (bar) bar.classList.add('hidden');
    const input = document.getElementById('regen-input');
    if (input) input.value = '';
    setRegenTriggered(false);
}

export async function sendRegenRequest() {
    const input = document.getElementById('regen-input');
    const reason = input ? input.value.trim() : '';
    if (!reason) {
        if (input) input.classList.add('border-coral-400');
        setTimeout(() => input && input.classList.remove('border-coral-400'), 1500);
        return;
    }

    const loading = document.getElementById('regen-loading');
    const result = document.getElementById('regen-result');
    const btn = document.getElementById('btn-regen-send');
    const API = getAPI();

    if (loading) loading.classList.remove('hidden');
    if (result) { result.classList.add('hidden'); result.textContent = ''; }
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }

    try {
        const res = await authFetch(`${API}/regenerate-delta`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason }),
        });
        const data = await res.json();

        if (!res.ok) {
            if (result) {
                result.textContent = data.detail || 'Regeneration failed. Try again.';
                result.classList.remove('hidden');
                result.className = result.className.replace('text-mint-400', 'text-coral-400');
            }
            return;
        }

        // Update store and re-render calendar
        setCurrentTasks(data.tasks);
        setCurrentSchedule(data.schedule);
        renderCalendar(data.tasks, data.schedule);
        renderTodayFocus(data.tasks);
        updateStats();

        // Show reasoning and hide bar after short delay
        const blocksMsg = data.blocks_updated === 0
            ? 'No changes needed.'
            : `${data.blocks_updated} block${data.blocks_updated === 1 ? '' : 's'} updated.`;

        if (result) {
            result.textContent = `${data.reasoning || ''} ${blocksMsg}`;
            result.classList.remove('hidden', 'text-coral-400');
            result.classList.add('text-mint-400');
        }

        // Auto-dismiss after 3 seconds
        setTimeout(() => hideRegenBar(), 3000);

    } catch (e) {
        if (result) {
            result.textContent = 'Failed to reach the server. Check connection.';
            result.classList.remove('hidden');
        }
    } finally {
        if (loading) loading.classList.add('hidden');
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}

export function initRegenerate() {
    const btnSend = document.getElementById('btn-regen-send');
    if (btnSend) btnSend.onclick = sendRegenRequest;

    const btnDismiss = document.getElementById('btn-regen-dismiss');
    if (btnDismiss) btnDismiss.onclick = hideRegenBar;

    const input = document.getElementById('regen-input');
    if (input) {
        input.onkeydown = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendRegenRequest();
            }
        };
    }
}
