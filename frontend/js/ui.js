/* frontend/js/ui.js */

// Explicitly define and export functions to avoid "not provide" errors
export function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

export function shakeEl(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.borderColor = '#F43F5E';
    el.style.animation = 'shake .4s ease';
    setTimeout(() => { el.style.borderColor = ''; el.style.animation = ''; }, 500);
}

export function showError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
}

export function hideError(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
}

export function spawnConfetti(origin) {
    const rect = origin.getBoundingClientRect();
    const colors = ['#6B47F5', '#10B981', '#FBBF24', '#F43F5E', '#38BDF8'];
    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = (rect.left + rect.width / 2 + (Math.random() - .5) * 60) + 'px';
        p.style.top = rect.top + 'px';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1500);
    }
}

const EXAM_COLORS = ['accent', 'mint', 'coral', 'gold', 'sky'];
const EXAM_HEX_MAP = {
    accent: '#6B47F5',
    mint:   '#10B981',
    coral:  '#F43F5E',
    gold:   '#F59E0B',
    sky:    '#38BDF8'
};

export function examColor(idx) { return EXAM_COLORS[idx % EXAM_COLORS.length]; }
export function examHex(idx) { return EXAM_HEX_MAP[examColor(idx)]; }

export function examColorClass(idx, type) {
    const map = {
        accent: { bg: 'bg-accent-500', bg20: 'bg-accent-500/20', text: 'text-accent-400', border: 'border-accent-500/30' },
        mint:   { bg: 'bg-mint-500',   bg20: 'bg-mint-500/20',   text: 'text-mint-400',   border: 'border-mint-500/30' },
        coral:  { bg: 'bg-coral-500',  bg20: 'bg-coral-500/20',  text: 'text-coral-400',  border: 'border-coral-500/30' },
        gold:   { bg: 'bg-gold-500',   bg20: 'bg-gold-500/20',   text: 'text-gold-400',   border: 'border-gold-500/30' },
        sky:    { bg: 'bg-sky-500',    bg20: 'bg-sky-500/20',    text: 'text-sky-400',    border: 'border-sky-500/30' },
    };
    return map[examColor(idx)][type];
}

export function showModal(id, active = true) {
    const el = document.getElementById(id);
    if (!el) return;

    if (el._modalTimeout) {
        clearTimeout(el._modalTimeout);
        el._modalTimeout = null;
    }

    if (active) {
        el.classList.remove('closing');
        el.classList.add('active');
    } else {
        if (!el.classList.contains('active') || el.classList.contains('closing')) return;
        el.classList.add('closing');
        el._modalTimeout = setTimeout(() => {
            el.classList.remove('active', 'closing');
            el._modalTimeout = null;
        }, 260);
    }
}

/**
 * Manages the progress bar and step-based status updates for long-running AI tasks.
 */
export class LoadingAnimator {
    constructor(prefix = 'loading') {
        this.progressBar = document.getElementById(`${prefix}-progress-bar`);
        this.progressPercent = document.getElementById(`${prefix}-progress-percent`);
        this.statusText = document.getElementById(`${prefix}-status-text`);
        this.prefix = prefix;
        this.interval = null;
        this.currentStep = 0;
        this.steps = [
            { p: 25, t: "Extracting syllabus constraints..." },
            { p: 50, t: "Mapping past exams to timeline..." },
            { p: 75, t: "Calculating optimal time blocks..." },
            { p: 92, t: "Finalizing your roadmap." }
        ];
    }

    start() {
        this.reset();
        // Cycle through all steps in ~5 seconds total
        this.interval = setInterval(() => {
            if (this.currentStep < this.steps.length) {
                const step = this.steps[this.currentStep];
                this.update(step.p, step.t);
                this.currentStep++;
            } else {
                // Stay at 92% until finished
                clearInterval(this.interval);
            }
        }, 1200); 

        // Set initial step
        const step = this.steps[0];
        this.update(step.p, step.t);
        this.currentStep = 1;
    }

    update(percent, text) {
        if (this.progressBar) this.progressBar.style.width = `${percent}%`;
        if (this.progressPercent) this.progressPercent.textContent = `${Math.round(percent)}%`;
        if (this.statusText && text) {
            this.statusText.classList.remove('status-fade');
            void this.statusText.offsetWidth; // Trigger reflow
            this.statusText.textContent = text;
            this.statusText.classList.add('status-fade');
        }
    }

    stop() {
        if (this.interval) clearInterval(this.interval);
        this.update(100, "Done!");
    }

    reset() {
        if (this.interval) clearInterval(this.interval);
        this.currentStep = 0;
        this.update(0, this.steps[0].t);
    }
}

let _profileTabsInitialized = false;
export function initProfileTabs() {
    if (_profileTabsInitialized) return;
    _profileTabsInitialized = true;

    const tabBtns = document.querySelectorAll('.profile-tab-btn');
    const tabPanes = document.querySelectorAll('.profile-tab-pane');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // Reset all buttons
            tabBtns.forEach(b => {
                b.classList.remove('bg-dark-700', 'text-white', 'shadow-sm', 'rounded-lg');
                b.classList.add('text-white/50');
            });
            // Set active button
            btn.classList.add('bg-dark-700', 'text-white', 'shadow-sm', 'rounded-lg');
            btn.classList.remove('text-white/50');

            // Hide all panes
            tabPanes.forEach(pane => pane.classList.add('hidden'));

            // Show target pane
            const targetId = btn.getAttribute('data-target');
            const targetPane = document.getElementById(targetId);
            if (targetPane) targetPane.classList.remove('hidden');

            // Hide Save button on tabs where it's not needed
            const saveWrapper = document.getElementById('save-settings-wrapper');
            if (saveWrapper) {
                saveWrapper.classList.toggle('hidden', targetId === 'tab-account' || targetId === 'tab-achievements');
            }

            // Load gamification data when Achievements tab is opened
            if (targetId === 'tab-achievements') {
                import('./profile.js?v=59').then(m => m.initGamification()).catch(() => {});
            }
        });
    });
}

export function showTaskEditModal(block, onSave, onDelete) {
    const modal = document.getElementById('modal-edit-task');
    if (!modal) return;

    const titleEl = document.getElementById('edit-task-title');
    if (titleEl) titleEl.value = block.task_title || '';

    // Use robust local-time parser (handles both ISO "T" and SQLite " " separators; no "Z" suffix)
    const parseLocal = (s) => new Date(s ? s.replace(' ', 'T').replace('Z', '') : '');
    const start = parseLocal(block.start_time);
    const end = parseLocal(block.end_time);
    const startStr = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    const startEl = document.getElementById('edit-task-start');
    if (startEl) startEl.value = startStr;

    const durationMin = Math.round(Math.abs(end - start) / 60000);
    const durationEl = document.getElementById('edit-task-duration');
    if (durationEl) durationEl.value = durationMin;
    
    const deferBtn = document.getElementById('btn-defer-task-modal');
    if (deferBtn) {
        if (block.block_type === 'study') {
            deferBtn.classList.remove('hidden');
            deferBtn.onclick = () => {
                showModal('modal-edit-task', false);
                if (block.id) window.dispatchEvent(new CustomEvent('block-defer', { detail: { blockId: parseInt(block.id, 10) } }));
            };
        } else {
            deferBtn.classList.add('hidden');
            deferBtn.onclick = null;
        }
    }

    showModal('modal-edit-task', true);
    
    document.getElementById('btn-close-edit-modal').onclick = () => showModal('modal-edit-task', false);
    
    document.getElementById('btn-save-task-edit').onclick = () => {
        const title = document.getElementById('edit-task-title').value;
        const startTimeStr = document.getElementById('edit-task-start').value;
        const duration = parseInt(document.getElementById('edit-task-duration').value);
        
        onSave({ title, startTimeStr, duration });
        showModal('modal-edit-task', false);
    };
    
    document.getElementById('btn-delete-task-modal').onclick = () => {
        // Close WITH animation to ensure internal state (blur/backdrop) clears correctly
        showModal('modal-edit-task', false);
        // Wait for modal-edit-task animation to finish (260ms) before showing confirm
        setTimeout(() => onDelete(block.id, block.block_type), 280);
    };
}

let _mobileTabBarInitialized = false;
export function initMobileTabBar() {
    if (_mobileTabBarInitialized) return;
    _mobileTabBarInitialized = true;

    const tabBar = document.getElementById('mobile-tab-bar');
    if (!tabBar) return;

    const panels = {
        roadmap: document.getElementById('mobile-roadmap-content'),
        focus:   document.getElementById('mobile-focus-panel'),
        exams:   document.getElementById('mobile-exams-panel'),
        profile: document.getElementById('mobile-profile-panel'),
    };
    const tabTitle = document.getElementById('mobile-tab-title');
    const titles = { roadmap: 'Roadmap', focus: "Today's Focus", exams: 'My Exams', profile: 'Profile' };

    function switchTab(tab) {
        // On desktop, we want to allow switching to Profile too
        const isDesktop = window.innerWidth >= 768;

        Object.entries(panels).forEach(([key, el]) => {
            if (!el) return;
            if (key === tab) {
                el.classList.remove('hidden');
            } else {
                // If on desktop, only hide/show Profile vs Dashboard content
                if (isDesktop) {
                    if (tab === 'profile') {
                        // Switch to Profile: hide roadmap/exams/focus
                        if (key !== 'profile') el.classList.add('hidden');
                    } else {
                        // Switch to Roadmap/Exams/Focus: show everything EXCEPT profile
                        if (key === 'profile') el.classList.add('hidden');
                        else el.classList.remove('hidden');
                    }
                } else {
                    el.classList.add('hidden');
                }
            }
        });

        if (tabTitle) tabTitle.textContent = titles[tab] || '';

        // Update active tab button styling (handles both mobile and desktop nav)
        document.querySelectorAll('.mobile-tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tab;
            btn.classList.toggle('text-accent-400', isActive);
            btn.classList.toggle('text-white/40', !isActive);
            // Update ARIA for accessibility
            if (btn.hasAttribute('aria-selected')) {
                btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
            }
        });

        // Special handling for Profile tab: ensure sub-tabs are initialized and fields populated
        if (tab === 'profile') {
            if (typeof window._populateSettingsFields === 'function') window._populateSettingsFields();
            import('./profile.js?v=59').then(m => m.initGamification()).catch(() => {});
        }
    }

    tabBar.querySelectorAll('.mobile-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Wire Exams panel action buttons
    document.getElementById('btn-add-exam-drawer')?.addEventListener('click', () => {
        document.getElementById('btn-add-exam-top')?.click();
    });

    // Avatar switches to Profile tab
    document.getElementById('mobile-user-avatar')?.addEventListener('click', () => {
        switchTab('profile');
    });

    // Settings button also switches to Profile tab
    document.getElementById('btn-show-settings')?.addEventListener('click', () => {
        switchTab('profile');
    });

    // Sign Out from the settings modal bottom button
    document.getElementById('btn-logout-drawer')?.addEventListener('click', () => {
        document.getElementById('btn-logout')?.click();
    });

    // Initialize default tab (roadmap)
    switchTab('roadmap');

    // On resize to desktop: handle panels visibility
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768) {
            // If profile is active, keep it shown and keep others hidden
            // Otherwise show all EXCEPT profile
            const isProfileActive = document.querySelector('.mobile-tab-btn[data-tab="profile"]')?.classList.contains('text-accent-400');
            if (!isProfileActive) {
                Object.entries(panels).forEach(([key, el]) => {
                    if (key === 'profile') el?.classList.add('hidden');
                    else el?.classList.remove('hidden');
                });
            }
        }
    });
}

export function showConfirmModal({ title, msg, icon, okText, onConfirm }) {
    const modal = document.getElementById('modal-confirm');
    if (!modal) return;

    // If a close animation is in progress, wait for it to finish before
    // re-opening. This prevents the modal from getting stuck mid-animation
    // when delete is triggered again after a block reappears.
    if (modal.classList.contains('closing')) {
        if (modal._modalTimeout) {
            clearTimeout(modal._modalTimeout);
            modal._modalTimeout = null;
        }
        modal.classList.remove('active', 'closing');
    }

    document.getElementById('confirm-title').innerText = title || 'Are you sure?';
    document.getElementById('confirm-msg').innerText = msg || 'This action cannot be undone.';
    document.getElementById('confirm-icon').innerText = icon || '🤔';
    document.getElementById('btn-confirm-ok').innerText = okText || 'Yes, Delete';

    showModal('modal-confirm', true);

    document.getElementById('btn-confirm-cancel').onclick = () => showModal('modal-confirm', false);
    document.getElementById('btn-confirm-ok').onclick = () => {
        showModal('modal-confirm', false);
        // Wait for modal-confirm animation to finish before doing the actual delete (which might re-render)
        if (onConfirm) setTimeout(() => onConfirm(), 280);
    };
}

export function showIosOnboarding() {
    // Basic iOS detection
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    // Only show if on iOS and not already installed/standalone
    if (isIos && !isStandalone) {
        showModal('modal-ios-onboarding', true);
        document.getElementById('btn-close-ios-onboarding').onclick = () => showModal('modal-ios-onboarding', false);
    }
}
window.showIosOnboarding = showIosOnboarding;

