/* StudyFlow — Gamification Frontend Module (ES6 Module) */

import { getAPI, authFetch } from './store.js?v=AUTO';

// ─── SVG circle constants ─────────────────────────────────────────────────────
// r=38, circumference = 2 * PI * 38 ≈ 238.76
const CIRCLE_CIRCUMFERENCE = 238.76;

// ─── Badge icon mapping ───────────────────────────────────────────────────────
const BADGE_ICONS = {
    first_task:       '✅',
    ten_tasks:        '🔟',
    fifty_tasks:      '💪',
    streak_3:         '🔥',
    streak_7:         '🔥🔥',
    streak_30:        '⚡',
    level_5:          '⭐',
    level_10:         '🌟',
    level_20:         '🏆',
    default:          '🎖',
};

function getBadgeIcon(badgeKey) {
    return BADGE_ICONS[badgeKey] || BADGE_ICONS.default;
}

function getBadgeLabel(badgeKey) {
    const labels = {
        first_task:   'First Task Done',
        ten_tasks:    '10 Tasks Done',
        fifty_tasks:  '50 Tasks Done',
        streak_3:     '3-Day Streak',
        streak_7:     '7-Day Streak',
        streak_30:    '30-Day Streak',
        level_5:      'Level 5',
        level_10:     'Level 10',
        level_20:     'Level 20',
    };
    return labels[badgeKey] || badgeKey.replace(/_/g, ' ');
}

// ─── XP Circle Rendering ─────────────────────────────────────────────────────

function updateXPCircles(xpData) {
    if (!xpData) return;

    // Daily XP circle: 0 – 200 XP goal per day
    const DAILY_GOAL = 200;
    const dailyProgress = Math.min((xpData.daily_xp || 0) / DAILY_GOAL, 1);
    const dailyOffset = CIRCLE_CIRCUMFERENCE * (1 - dailyProgress);

    const dailyCircle = document.getElementById('xp-circle-daily');
    if (dailyCircle) {
        dailyCircle.style.strokeDashoffset = dailyOffset;
        dailyCircle.style.transition = 'stroke-dashoffset 0.6s ease';
    }
    const dailyLabel = document.getElementById('xp-daily-label');
    if (dailyLabel) dailyLabel.textContent = `${xpData.daily_xp || 0} XP`;

    // Overall XP circle: 0 – 1000 XP per level
    const XP_PER_LEVEL = 1000;
    const levelXp = (xpData.total_xp || 0) % XP_PER_LEVEL;
    const overallProgress = levelXp / XP_PER_LEVEL;
    const overallOffset = CIRCLE_CIRCUMFERENCE * (1 - overallProgress);

    const overallCircle = document.getElementById('xp-circle-overall');
    if (overallCircle) {
        overallCircle.style.strokeDashoffset = overallOffset;
        overallCircle.style.transition = 'stroke-dashoffset 0.6s ease';
    }
    const overallLabel = document.getElementById('xp-overall-label');
    if (overallLabel) overallLabel.textContent = `Lvl ${xpData.current_level || 1}`;
}

// ─── Badge Grid Rendering ─────────────────────────────────────────────────────

function renderBadgeGrid(badges) {
    const container = document.getElementById('achievement-badges');
    if (!container) return;

    if (!badges || badges.length === 0) {
        container.innerHTML = '<p class="text-white/30 text-sm text-center py-4">No badges yet. Complete tasks to earn them!</p>';
        return;
    }

    container.innerHTML = badges.map(b => `
        <div class="flex items-center gap-3 bg-dark-900/40 rounded-xl p-3 border border-white/5">
            <span class="text-2xl">${getBadgeIcon(b.badge_key)}</span>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-white truncate">${getBadgeLabel(b.badge_key)}</p>
                <p class="text-xs text-white/30">${b.earned_at ? b.earned_at.substring(0, 10) : ''}</p>
            </div>
        </div>
    `).join('');
}

// ─── Achievements Tab Rendering ───────────────────────────────────────────────

function renderAchievementsTab(summary) {
    if (!summary) return;

    // Streak display
    const streakEl = document.getElementById('achievement-streak');
    if (streakEl) {
        streakEl.textContent = summary.streak?.current_streak ?? 0;
    }

    // XP circles
    updateXPCircles(summary.xp);

    // Badge grid (newest first — API already returns desc order)
    renderBadgeGrid(summary.badges || []);
}

// ─── initGamification ─────────────────────────────────────────────────────────

export async function initGamification() {
    const API = getAPI();
    try {
        const res = await authFetch(`${API}/gamification/summary`);
        if (!res.ok) return;
        const summary = await res.json();
        renderAchievementsTab(summary);
    } catch (e) {
        console.warn('initGamification failed:', e);
    }
}

// ─── updateXPDisplay ──────────────────────────────────────────────────────────

export function updateXPDisplay(xpResult) {
    if (!xpResult || xpResult.xp_earned <= 0) return;
    updateXPCircles({
        daily_xp: xpResult.daily_xp,
        total_xp: xpResult.new_total,
        current_level: xpResult.new_level,
    });
}

// ─── showStreakSplash ─────────────────────────────────────────────────────────

export function showStreakSplash(streak, isMilestone) {
    const modal = document.getElementById('modal-streak-splash');
    if (!modal) return;

    const streakNumEl = modal.querySelector('#splash-streak-num');
    if (streakNumEl) streakNumEl.textContent = streak;

    const msgEl = modal.querySelector('#splash-streak-msg');
    if (msgEl) {
        if (isMilestone) {
            msgEl.textContent = 'Incredible milestone! Keep it going!';
        } else if (streak >= 7) {
            msgEl.textContent = 'You\'re on fire! Amazing consistency.';
        } else if (streak >= 3) {
            msgEl.textContent = 'Great work! Momentum is everything.';
        } else {
            msgEl.textContent = 'Every day counts. Keep showing up!';
        }
    }

    modal.classList.add('active');

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
        modal.classList.remove('active');
    }, 4000);
}

// ─── showMorningPrompt ────────────────────────────────────────────────────────

export function showMorningPrompt(tasks) {
    const modal = document.getElementById('modal-morning-prompt');
    if (!modal) return;
    if (!tasks || tasks.length === 0) return;

    const listEl = modal.querySelector('#morning-prompt-list');
    if (listEl) {
        const API = getAPI();
        listEl.innerHTML = tasks.map(t => `
            <div class="flex items-center justify-between gap-3 bg-dark-900/40 rounded-xl p-3 border border-white/5 mb-2">
                <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-white truncate">${t.title || 'Untitled'}</p>
                    <p class="text-xs text-white/40">${t.subject || ''} · ${t.estimated_hours || 1}h</p>
                </div>
                <button
                    class="flex-shrink-0 px-3 py-1.5 rounded-lg bg-accent-500/20 text-accent-400 text-xs font-semibold hover:bg-accent-500/40 transition-colors"
                    onclick="window._rescheduleTask(${t.id}, 'reschedule', this)"
                >Reschedule</button>
            </div>
        `).join('');
    }

    modal.classList.add('active');

    // Wire "All done" button
    const doneBtn = modal.querySelector('#btn-morning-done');
    if (doneBtn) {
        doneBtn.onclick = () => modal.classList.remove('active');
    }
}

// ─── reschedule helper (global for inline onclick) ─────────────────────────

window._rescheduleTask = async function(taskId, action, btn) {
    const API = getAPI();
    try {
        if (btn) btn.disabled = true;
        const res = await authFetch(`${API}/gamification/reschedule-task/${taskId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action }),
        });
        if (res.ok && btn) {
            btn.textContent = 'Done';
            btn.classList.replace('bg-accent-500/20', 'bg-mint-500/20');
            btn.classList.replace('text-accent-400', 'text-mint-400');
        }
    } catch (e) {
        console.warn('rescheduleTask failed:', e);
        if (btn) btn.disabled = false;
    }
};

// ─── registerLoginCheckFlow ──────────────────────────────────────────────────

export function registerLoginCheckFlow() {
    const API = getAPI();
    authFetch(`${API}/gamification/login-check`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            if (!data.first_login_today) return;

            // First login today — show streak splash if streak >= 3
            if (data.streak >= 3) {
                showStreakSplash(data.streak, data.is_milestone);
            }

            // After splash (or immediately if no splash), show morning prompt
            const morningDelay = data.streak >= 3 ? 4500 : 0;
            if (data.morning_tasks && data.morning_tasks.length > 0) {
                setTimeout(() => {
                    showMorningPrompt(data.morning_tasks);
                }, morningDelay);
            }
        })
        .catch(e => {
            console.warn('loginCheckFlow failed:', e);
        });
}
