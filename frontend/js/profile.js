/* StudyFlow — Gamification Frontend Module (ES6 Module) */

import { getAPI, authFetch, getCurrentUser } from './store.js?v=59';
import { spawnConfetti } from './ui.js?v=59';

// ─── SVG circle constants ─────────────────────────────────────────────────────
// r=38, circumference = 2 * PI * 38 ≈ 238.76
const CIRCLE_CIRCUMFERENCE = 238.76;
const API = getAPI();

// ─── Badge icon mapping ───────────────────────────────────────────────────────
const BADGE_ICONS = {
    // First-time achievements
    first_task:          '✅',
    first_login:         '👋',
    week_streak:         '🔥',
    streak_broken_once:  '💔',
    // Streak milestones
    iron_will_7:         '🔥🔥',
    iron_will_10:        '⚡',
    iron_will_14:        '🏆',
    iron_will_30:        '💎',
    iron_will_100:       '👑',
    // Level milestones
    knowledge_seeker_5:  '⭐',
    knowledge_seeker_10: '🌟',
    knowledge_seeker_20: '💡',
    knowledge_seeker_25: '💎',
    knowledge_seeker_50: '👑',
    knowledge_seeker_100: '🌌',
    // Task milestones
    task_master_10:      '📖',
    task_master_20:      '📚',
    task_master_50:      '📜',
    task_master_100:     '🏅',
    // XP milestones
    xp_1000:             '🎯',
    xp_5000:             '🚀',
    xp_10000:            '🌌',
    // Fallback
    default:             '🎖',
};

function getBadgeIcon(badgeKey) {
    return BADGE_ICONS[badgeKey] || BADGE_ICONS.default;
}

function getBadgeLabel(badgeKey) {
    const labels = {
        // First-time achievements
        first_task:          'First Task Done',
        first_login:         'First Login',
        week_streak:         '7-Day Streak',
        streak_broken_once:  'Streak Broken',
        // Streak milestones
        iron_will_7:         '7-Day Streak',
        iron_will_10:        '10-Day Streak',
        iron_will_14:        '14-Day Streak',
        iron_will_30:        '30-Day Streak',
        iron_will_100:       '100-Day Streak',
        // Level milestones
        knowledge_seeker_5:  'Knowledge Seeker — Lvl 5',
        knowledge_seeker_10: 'Knowledge Seeker — Lvl 10',
        knowledge_seeker_20: 'Knowledge Seeker — Lvl 20',
        knowledge_seeker_25: 'Knowledge Seeker — Lvl 25',
        knowledge_seeker_50: 'Knowledge Seeker — Lvl 50',
        knowledge_seeker_100: 'Grand Master — Lvl 100',
        // Task milestones
        task_master_10:      '10 Tasks Completed',
        task_master_20:      '20 Tasks Completed',
        task_master_50:      '50 Tasks Completed',
        task_master_100:     '100 Tasks Completed',
        // XP milestones
        xp_1000:             '1,000 XP Earned',
        xp_5000:             '5,000 XP Earned',
        xp_10000:            '10,000 XP Earned',
    };
    return labels[badgeKey] || badgeKey.replace(/_/g, ' ');
}

// ─── XP Circle Rendering ─────────────────────────────────────────────────────

function updateXPCircles(xpData) {
    if (!xpData) return;

    // Daily XP circle: Dynamic goal based on study hours (Baseline: 50 XP/hour)
    const user = getCurrentUser();
    const netoStudyHours = parseFloat(user?.neto_study_hours) || 4.0;
    const DAILY_GOAL = 50 * netoStudyHours;
    
    const dailyProgress = Math.min((xpData.daily_xp || 0) / DAILY_GOAL, 1);
    const dailyOffset = CIRCLE_CIRCUMFERENCE * (1 - dailyProgress);

    const dailyCircle = document.getElementById('xp-circle-daily');
    if (dailyCircle) {
        dailyCircle.style.strokeDashoffset = dailyOffset;
        dailyCircle.style.transition = 'stroke-dashoffset 0.6s ease';
    }
    const dailyLabel = document.getElementById('xp-daily-label');
    if (dailyLabel) dailyLabel.textContent = `${Math.floor(xpData.daily_xp || 0)} XP`;

    // Overall XP circle: 0 – 1000 XP per level
    const XP_PER_LEVEL = 1000;
    const isMaxLevel = (xpData.current_level || 1) >= 50;
    
    let overallProgress = 0;
    if (isMaxLevel) {
        overallProgress = 1; // Full circle for level 50
    } else {
        const levelXp = (xpData.total_xp || 0) % XP_PER_LEVEL;
        overallProgress = levelXp / XP_PER_LEVEL;
    }
    
    const overallOffset = CIRCLE_CIRCUMFERENCE * (1 - overallProgress);

    const overallCircle = document.getElementById('xp-circle-overall');
    if (overallCircle) {
        overallCircle.style.strokeDashoffset = overallOffset;
        overallCircle.style.transition = 'stroke-dashoffset 0.6s ease';
    }
    const overallLabel = document.getElementById('xp-overall-label');
    if (overallLabel) overallLabel.textContent = `Lvl ${xpData.current_level || 1}`;

    // Update profile header level badge
    const levelBadge = document.getElementById('profile-level-badge');
    if (levelBadge) levelBadge.textContent = `Lvl ${xpData.current_level || 1}`;
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

// ─── Live badge append (called after award-xp returns badges_earned) ──────────

export function showBadgeSplash(badgeKey) {
    const modal = document.getElementById('modal-badge-splash');
    const iconEl = document.getElementById('splash-badge-icon');
    const nameEl = document.getElementById('splash-badge-name');
    if (!modal || !iconEl || !nameEl) return;

    iconEl.textContent = getBadgeIcon(badgeKey);
    nameEl.textContent = getBadgeLabel(badgeKey);
    modal.classList.add('active');

    // Confetti!
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    spawnConfetti({ getBoundingClientRect: () => ({ left: centerX - 30, top: centerY, width: 60, height: 0 }) });

    const btn = document.getElementById('btn-close-badge-splash');
    if (btn) {
        btn.onclick = () => modal.classList.remove('active');
    }

    // Auto-dismiss after 4 seconds
    setTimeout(() => modal.classList.remove('active'), 4000);
}

export function appendNewBadges(badgeKeys) {
    if (!badgeKeys || badgeKeys.length === 0) return;
    const container = document.getElementById('achievement-badges');
    if (!container) return;

    // Remove empty-state placeholder if present
    const placeholder = container.querySelector('p');
    if (placeholder) placeholder.remove();

    const now = new Date().toISOString().substring(0, 10);
    const newCards = badgeKeys.map(key => `
        <div class="flex items-center gap-3 bg-dark-900/40 rounded-xl p-3 border border-white/5 badge-new-flash">
            <span class="text-2xl">${getBadgeIcon(key)}</span>
            <div class="flex-1 min-w-0">
                <p class="text-sm font-semibold text-white truncate">${getBadgeLabel(key)}</p>
                <p class="text-xs text-white/30">${now}</p>
            </div>
        </div>
    `).join('');

    // Prepend — newest first, matching API order
    container.insertAdjacentHTML('afterbegin', newCards);

    // Show splash for the first (newest) badge in the list
    showBadgeSplash(badgeKeys[0]);
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
    if (!xpResult) return;
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
    console.log('[DEBUG] showMorningPrompt called with tasks:', tasks);
    const modal = document.getElementById('modal-morning-prompt');
    if (!modal) return;

    const contentArea = modal.querySelector('#morning-prompt-content');
    const listEl = modal.querySelector('#morning-prompt-list');
    const summaryArea = modal.querySelector('#morning-summary');
    const actionArea = modal.querySelector('#morning-prompt-actions');
    
    if (!listEl || !summaryArea || !actionArea) return;

    // Reset UI state
    listEl.classList.remove('hidden');
    summaryArea.classList.add('hidden');
    actionArea.classList.remove('hidden');

    if (!tasks || tasks.length === 0) {
        modal.classList.remove('active');
        return;
    }

    // Render task list with checkboxes
    listEl.innerHTML = tasks.map(t => `
        <label class="flex items-center gap-3 bg-dark-900/40 rounded-2xl p-4 border border-white/5 active:scale-[0.98] transition-all cursor-pointer">
            <input type="checkbox" name="morning-task" value="${t.id}" checked
                   class="w-5 h-5 rounded-lg accent-accent-500 bg-dark-700 border-white/10">
            <div class="flex-1 min-w-0 ml-1">
                <p class="text-sm font-bold text-white truncate">${t.title || 'Untitled'}</p>
                <p class="text-[10px] text-white/40 uppercase tracking-wider font-semibold">${t.subject || 'No Subject'} · ${t.estimated_hours || 1}h</p>
            </div>
        </label>
    `).join('');

    modal.classList.add('active');

    // Wire actions
    const btnPush = modal.querySelector('#btn-morning-push');
    const btnDeleteAll = modal.querySelector('#btn-morning-delete-all');
    const btnCloseSummary = modal.querySelector('#btn-morning-close-summary');

    // Dismiss without action (e.g. backdrop click or close button) — still refresh calendar
    const btnDismiss = modal.querySelector('#btn-morning-dismiss');
    if (btnDismiss) {
        btnDismiss.onclick = () => {
            modal.classList.remove('active');
            window.dispatchEvent(new CustomEvent('calendar-needs-refresh'));
        };
    }

    btnPush.onclick = async () => {
        const allCheckboxes = Array.from(modal.querySelectorAll('input[name="morning-task"]'));
        const selectedIds = allCheckboxes.filter(i => i.checked).map(i => parseInt(i.value));
        const unselectedIds = allCheckboxes.filter(i => !i.checked).map(i => parseInt(i.value));

        if (selectedIds.length === 0 && unselectedIds.length === 0) return;

        try {
            btnPush.disabled = true;
            btnPush.textContent = 'Processing...';

            // Single atomic call: reschedule selected + delete unselected
            const res = await authFetch(`${API}/gamification/batch-reschedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_ids: selectedIds,
                    action: 'reschedule',
                    delete_ids: unselectedIds.length > 0 ? unselectedIds : undefined,
                }),
            });
            const data = await res.json();
            if (res.ok && data.results) {
                _showMorningSummary(data.results);
            }
        } catch (e) {
            console.error('Push failed:', e);
            btnPush.disabled = false;
            btnPush.textContent = 'Push to next days';
        }
    };

    btnDeleteAll.onclick = async () => {
        if (!confirm('Are you sure you want to delete all unfinished tasks?')) return;
        const allIds = tasks.map(t => t.id);
        try {
            btnDeleteAll.disabled = true;
            btnDeleteAll.textContent = 'Deleting...';
            const res = await authFetch(`${API}/gamification/batch-reschedule`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_ids: allIds, action: 'delete' }),
            });
            const data = await res.json();
            if (res.ok && data.results) _showMorningSummary(data.results);
        } catch (e) {
            console.error('Delete failed:', e);
            btnDeleteAll.disabled = false;
            btnDeleteAll.textContent = 'Delete';
        }
    };

    btnCloseSummary.onclick = () => {
        modal.classList.remove('active');
        // Refresh roadmap to show moved tasks
        window.dispatchEvent(new CustomEvent('calendar-needs-refresh'));
    };
}

function _showMorningSummary(results) {
    const modal = document.getElementById('modal-morning-prompt');
    const listEl = modal.querySelector('#morning-prompt-list');
    const summaryArea = modal.querySelector('#morning-summary');
    const summaryList = modal.querySelector('#morning-summary-list');
    const actionArea = modal.querySelector('#morning-prompt-actions');

    if (!results || results.length === 0) {
        modal.classList.remove('active');
        return;
    }

    // Switch to summary view
    listEl.classList.add('hidden');
    actionArea.classList.add('hidden');
    summaryArea.classList.remove('hidden');

    summaryList.innerHTML = results.map(r => {
        let text = r.title;
        if (r.status === 'moved') {
            const today = new Date();
            const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
            
            const fmt = (d) => d.toISOString().split('T')[0];
            let dateLabel = r.new_date;
            if (r.new_date === fmt(today)) dateLabel = '<span class="text-accent-400">Today</span>';
            else if (r.new_date === fmt(tomorrow)) dateLabel = '<span class="text-mint-400">Tomorrow</span>';
            
            text = `Moved <b>${r.title}</b> to ${dateLabel}`;
        } else {
            text = `Deleted <b>${r.title}</b>`;
        }
        return `<li class="flex items-start gap-2 py-1 border-b border-white/5 last:border-0 text-xs text-white/80">
            <span class="text-mint-400 mt-0.5">✓</span>
            <span>${text}</span>
        </li>`;
    }).join('');
    
    // Success Confetti
    if (typeof spawnConfetti === 'function') {
        const rect = summaryArea.getBoundingClientRect();
        spawnConfetti({ getBoundingClientRect: () => ({ left: rect.left + rect.width/2, top: rect.top, width: 0, height: 0 }) });
    }
}

// ─── showDailyCelebration ─────────────────────────────────────────────────────

let _celebrationAutoClose = null;

export function showDailySummary(data) {
    const modal = document.getElementById('modal-daily-summary');
    const yMsg = document.getElementById('summary-yesterday-msg');
    const tMsg = document.getElementById('summary-today-msg');
    if (!modal || !data) return;

    if (yMsg) {
        yMsg.textContent = `You completed ${data.yesterday_tasks || 0} task${data.yesterday_tasks === 1 ? '' : 's'}.`;
    }
    if (tMsg) {
        tMsg.textContent = `${data.today_goal || 4.0} hours of focused study.`;
    }

    modal.classList.add('active');
    const btn = document.getElementById('btn-close-summary');
    if (btn) btn.onclick = () => modal.classList.remove('active');
}

export function showDailyCelebration() {
    const modal = document.getElementById('modal-daily-celebration');
    if (!modal) return;

    // Show the modal
    modal.classList.add('active');

    // Spawn confetti from multiple points for full-screen effect
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;
    const dummyOrigin = { getBoundingClientRect: () => ({ left: centerX - 30, top: centerY, width: 60, height: 0 }) };
    
    // Multiple bursts
    spawnConfetti(dummyOrigin);
    setTimeout(() => spawnConfetti({ getBoundingClientRect: () => ({ left: centerX * 0.5, top: centerY * 1.2, width: 40, height: 0 }) }), 200);
    setTimeout(() => spawnConfetti({ getBoundingClientRect: () => ({ left: centerX * 1.5, top: centerY * 1.2, width: 40, height: 0 }) }), 400);

    // Wire close button
    const closeBtn = modal.querySelector('#btn-close-celebration');
    if (closeBtn) {
        closeBtn.onclick = () => {
            modal.classList.remove('active');
            if (_celebrationAutoClose) clearTimeout(_celebrationAutoClose);
        };
    }

    // Auto-dismiss after 3.5 seconds
    if (_celebrationAutoClose) clearTimeout(_celebrationAutoClose);
    _celebrationAutoClose = setTimeout(() => {
        modal.classList.remove('active');
        _celebrationAutoClose = null;
    }, 3500);
}

// ─── registerLoginCheckFlow ──────────────────────────────────────────────────

export function registerLoginCheckFlow() {
    authFetch(`${API}/gamification/login-check`, { method: 'POST' })
        .then(r => r.json())
        .then(data => {
            if (!data.first_login_today) return;

            // First login today — show streak splash ONLY if it is a milestone (7, 10, 14, 30, 100)
            if (data.streak >= 3 && data.is_milestone) {
                showStreakSplash(data.streak, true);
            }

            // After splash (or immediately if no splash), show daily summary
            const summaryDelay = (data.streak >= 3 && data.is_milestone) ? 4500 : 0;
            if (data.daily_summary) {
                setTimeout(() => {
                    showDailySummary(data.daily_summary);
                }, summaryDelay);
            }

            // After summary (or splash), show morning prompt
            const morningDelay = summaryDelay + (data.daily_summary ? 4000 : 0);
            if (data.morning_tasks && data.morning_tasks.length > 0) {
                setTimeout(() => {
                    showMorningPrompt(data.morning_tasks);
                }, morningDelay);
            }

            // Show badges earned at login (e.g. first_login, streak milestones)
            if (data.badges_newly_earned && data.badges_newly_earned.length > 0) {
                const badgeDelay = morningDelay + (data.morning_tasks?.length > 0 ? 4000 : 0);
                setTimeout(() => {
                    appendNewBadges(data.badges_newly_earned);
                }, badgeDelay);
            }
        })
        .catch(e => {
            console.warn('loginCheckFlow failed:', e);
        });
}
