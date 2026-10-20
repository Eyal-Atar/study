/* frontend/js/auth.js */
import { getAPI, setCurrentUser, authFetch, resetStore, getCurrentUser } from './store.js?v=AUTO';
import { showRegenBar } from './brain.js?v=AUTO';
import { showScreen, shakeEl, showError, hideError } from './ui.js?v=AUTO';
import { initOnboarding } from './onboarding.js?v=AUTO';

let onAuthSuccess = () => {};

export function initAuth(callbacks = {}) {
    if (callbacks.onSuccess) onAuthSuccess = callbacks.onSuccess;

    // Welcome screen buttons
    const btnShowRegister = document.getElementById('btn-show-register');
    if (btnShowRegister) btnShowRegister.onclick = () => showScreen('screen-register');

    const btnShowLogin = document.getElementById('btn-show-login');
    if (btnShowLogin) btnShowLogin.onclick = () => showScreen('screen-login');

    // Login screen
    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) btnLogin.onclick = handleLogin;

    const loginEmail = document.getElementById('login-email');
    if (loginEmail) {
        loginEmail.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const passwordField = document.getElementById('login-password');
                if (passwordField) passwordField.focus();
            }
        };
    }

    const loginPassword = document.getElementById('login-password');
    if (loginPassword) {
        loginPassword.onkeydown = (e) => {
            if (e.key === 'Enter') handleLogin();
        };
    }

    const linkToRegister = document.getElementById('link-to-register');
    if (linkToRegister) {
        linkToRegister.onclick = (e) => {
            e.preventDefault();
            showScreen('screen-register');
            return false;
        };
    }

    const linkLoginBack = document.getElementById('link-login-back');
    if (linkLoginBack) {
        linkLoginBack.onclick = (e) => {
            e.preventDefault();
            showScreen('screen-welcome');
            return false;
        };
    }

    // Register screen navigation
    const linkToLogin = document.getElementById('link-to-login');
    if (linkToLogin) {
        linkToLogin.onclick = (e) => {
            e.preventDefault();
            showScreen('screen-login');
            return false;
        };
    }

    const linkRegBack = document.getElementById('link-reg-back');
    if (linkRegBack) {
        linkRegBack.onclick = (e) => {
            e.preventDefault();
            showScreen('screen-welcome');
            return false;
        };
    }

    // Register step buttons
    const btnRegNext2 = document.getElementById('btn-reg-next-2');
    if (btnRegNext2) btnRegNext2.onclick = () => regNext(3); // Skip step 2 (removed)

    const btnRegister = document.getElementById('btn-register');
    if (btnRegister) btnRegister.onclick = handleRegister;

    // Register keyboard navigation
    const regName = document.getElementById('reg-name');
    if (regName) {
        regName.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const emailField = document.getElementById('reg-email');
                if (emailField) emailField.focus();
            }
        };
    }

    const regEmail = document.getElementById('reg-email');
    if (regEmail) {
        regEmail.onkeydown = (e) => {
            if (e.key === 'Enter') {
                const passwordField = document.getElementById('reg-password');
                if (passwordField) passwordField.focus();
            }
        };
    }

    const regPassword = document.getElementById('reg-password');
    if (regPassword) {
        regPassword.onkeydown = (e) => {
            if (e.key === 'Enter') regNext(3);
        };
    }

    // Logout button
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.onclick = handleLogout;

    // Settings
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const settingsHours = document.getElementById('settings-hours');
    const settingsHoursLabel = document.getElementById('settings-hours-label');

    // Helper to populate settings fields from current user data
    window._populateSettingsFields = () => {
        const user = getCurrentUser();
        if (!user) return;
        // Profile header card
        const profileAvatar = document.getElementById('profile-avatar');
        const profileName = document.getElementById('profile-display-name');
        const profileEmail = document.getElementById('profile-display-email');
        if (profileAvatar) profileAvatar.textContent = (user.name || '?').charAt(0).toUpperCase();
        if (profileName) profileName.textContent = user.name || 'Student';
        if (profileEmail) profileEmail.textContent = user.email || '';

        const emailDisplay = document.getElementById('settings-email-display');
        if (emailDisplay) emailDisplay.textContent = user.email || '';
        if (document.getElementById('settings-name')) document.getElementById('settings-name').value = user.name || '';
        if (document.getElementById('settings-hobby')) document.getElementById('settings-hobby').value = user.hobby_name || '';
        if (document.getElementById('settings-wake')) document.getElementById('settings-wake').value = user.wake_up_time || '08:00';
        if (document.getElementById('settings-sleep')) document.getElementById('settings-sleep').value = user.sleep_time || '23:00';
        if (document.getElementById('settings-hours')) {
            document.getElementById('settings-hours').value = user.neto_study_hours || 4.0;
            if (document.getElementById('settings-hours-label')) {
                document.getElementById('settings-hours-label').textContent = (user.neto_study_hours || 4.0).toFixed(1);
            }
        }
        if (document.getElementById('settings-peak')) document.getElementById('settings-peak').value = user.peak_productivity || 'Morning';
        
        // Notification preferences
        const notifTiming = document.getElementById('settings-notif-timing');
        if (notifTiming) notifTiming.value = user.notif_timing || 'at_start';
        const notifPerTask = document.getElementById('settings-notif-per-task');
        if (notifPerTask) notifPerTask.checked = (user.notif_per_task ?? 1) === 1;
        const notifDailySummary = document.getElementById('settings-notif-daily-summary');
        if (notifDailySummary) notifDailySummary.checked = (user.notif_daily_summary ?? 0) === 1;
        
        if (typeof window._updateNotifStatus === 'function') window._updateNotifStatus();
    };

    if (settingsHours) {
        settingsHours.oninput = () => {
            if (settingsHoursLabel) settingsHoursLabel.textContent = parseFloat(settingsHours.value).toFixed(1);
        };
    }

    if (btnSaveSettings) btnSaveSettings.onclick = handleSaveSettings;
}

export function regNext(step) {
    // Validate credentials before leaving step 1 (step 2 removed, so validate on step 3)
    if (step >= 3) {
        hideError('reg-error-1');
        const nameEl = document.getElementById('reg-name');
        const emailEl = document.getElementById('reg-email');
        const passEl = document.getElementById('reg-password');
        const name = nameEl ? nameEl.value.trim() : '';
        const email = emailEl ? emailEl.value.trim() : '';
        const password = passEl ? passEl.value : '';
        if (!name) { shakeEl('reg-name'); return; }
        if (!email || !email.includes('@')) { shakeEl('reg-email'); showError('reg-error-1', 'Valid email required'); return; }
        if (password.length < 6) { shakeEl('reg-password'); showError('reg-error-1', 'Password must be at least 6 characters'); return; }
    }
    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById(`reg-step-${i}`);
        if (el) el.style.display = i === step ? 'block' : 'none';
    }
    for (let i = 1; i <= 3; i++) {
        const dot = document.getElementById(`reg-dot-${i}`);
        if (dot) dot.className = `w-2.5 h-2.5 rounded-full transition-all ${i <= step ? 'bg-accent-500' : 'bg-white/20'}`;
    }
}

export async function handleLogin() {
    const API = getAPI();
    hideError('login-error');

    const emailEl = document.getElementById('login-email');
    const passEl = document.getElementById('login-password');
    const btn = document.getElementById('btn-login');

    const email = emailEl ? emailEl.value.trim() : '';
    const password = passEl ? passEl.value : '';

    if (!email) { shakeEl('login-email'); return; }
    if (!password) { shakeEl('login-password'); return; }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Logging in...';
    }

    try {
        const res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // Include cookies
            body: JSON.stringify({ email, password }),
        });
        let data;
        try { data = await res.json(); } catch { data = {}; }
        if (!res.ok) {
            showError('login-error', data.detail || (res.status >= 500 ? 'Server error — please try again later' : 'Login failed'));
            return;
        }
        // Token is now in HttpOnly cookie, not in response
        setCurrentUser(data.user);
        
        // If onboarding not completed, show onboarding wizard
        if (data.user.onboarding_completed === 0 || data.user.onboarding_completed === null) {
            initOnboarding();
            showScreen('screen-onboarding');
        } else {
            // Show the dashboard screen FIRST to ensure UI transitions even if init fails
            showScreen('screen-dashboard');
            
            setTimeout(() => {
                try { onAuthSuccess(); } catch (_) {}
            }, 50);
        }
    } catch (e) {
        showError('login-error', 'No internet connection — check your network and try again');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Log In'; }
    }
}

export async function handleRegister() {
    const API = getAPI();
    hideError('reg-error-3');
    const nameEl = document.getElementById('reg-name');
    const emailEl = document.getElementById('reg-email');
    const passEl = document.getElementById('reg-password');
    const name = nameEl ? nameEl.value.trim() : '';
    const email = emailEl ? emailEl.value.trim() : '';
    const password = passEl ? passEl.value : '';
    const wakeEl = document.getElementById('reg-wake');
    const sleepEl = document.getElementById('reg-sleep');
    const wake = wakeEl ? wakeEl.value : '08:00';
    const sleep = sleepEl ? sleepEl.value : '23:00';

    const btn = document.getElementById('btn-register');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }
    try {
        const res = await fetch(`${API}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                name, email, password,
                study_method: 'continuous',
                wake_up_time: wake,
                sleep_time: sleep,
                session_minutes: 90,
                break_minutes: 10,
                timezone_offset: new Date().getTimezoneOffset(),
            }),
        });
        let data;
        try { data = await res.json(); } catch { data = {}; }
        if (!res.ok) {
            showError('reg-error-3', data.detail || (res.status >= 500 ? 'Server error — please try again later' : 'Registration failed'));
            return;
        }
        // Token is now in HttpOnly cookie, not in response
        setCurrentUser(data.user);
        if (data.user.onboarding_completed === 0 || data.user.onboarding_completed === null) {
            initOnboarding();
            showScreen('screen-onboarding');
        } else {
            onAuthSuccess();
            showScreen('screen-dashboard');
        }
    } catch (e) {
        showError('reg-error-3', 'No internet connection — check your network and try again');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
    }
}

export async function handleLogout() {
    const API = getAPI();
    try { await authFetch(`${API}/auth/logout`, { method: 'POST' }); } catch (e) { console.warn('Logout request failed:', e); }
    
    resetStore();
    showScreen('screen-welcome');
}

export async function handleSaveSettings() {
    const API = getAPI();
    const btn = document.getElementById('btn-save-settings');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    // Capture old hours before save to detect a change
    const oldUser = getCurrentUser();
    const oldHours = oldUser ? (oldUser.neto_study_hours || 0) : 0;

    const hoursEl = document.getElementById('settings-hours');
    const newHours = hoursEl ? parseFloat(hoursEl.value) : (oldHours || 4.0);
    const payload = {
        name: (document.getElementById('settings-name')?.value || '').trim(),
        hobby_name: (document.getElementById('settings-hobby')?.value || '').trim(),
        wake_up_time: document.getElementById('settings-wake')?.value || '08:00',
        sleep_time: document.getElementById('settings-sleep')?.value || '23:00',
        neto_study_hours: newHours,
        peak_productivity: document.getElementById('settings-peak').value,
        timezone_offset: new Date().getTimezoneOffset(),
        notif_timing: document.getElementById('settings-notif-timing')?.value || 'at_start',
        notif_per_task: document.getElementById('settings-notif-per-task')?.checked ? 1 : 0,
        notif_daily_summary: document.getElementById('settings-notif-daily-summary')?.checked ? 1 : 0,
    };

    try {
        const res = await authFetch(`${API}/users/me`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || (res.status >= 500 ? 'Server error — please try again later' : 'Failed to update settings'));
            return;
        }
        const user = await res.json();
        setCurrentUser(user);

        // Update greeting in dashboard
        const greetingEl = document.getElementById('user-greeting');
        if (greetingEl) greetingEl.textContent = `Hey, ${user.name}`;

        // Update profile header card
        const profileAvatar = document.getElementById('profile-avatar');
        const profileName = document.getElementById('profile-display-name');
        if (profileAvatar) profileAvatar.textContent = (user.name || '?').charAt(0).toUpperCase();
        if (profileName) profileName.textContent = user.name || 'Student';

        // Show regen bar if study hours changed
        if (newHours !== oldHours) {
            showRegenBar('Study hours changed — update the schedule if needed.');
        }

        // Visual save confirmation
        if (btn) {
            btn.textContent = 'Saved!';
            btn.classList.remove('bg-accent-500', 'hover:bg-accent-600');
            btn.classList.add('bg-mint-500');
            setTimeout(() => {
                btn.classList.remove('bg-mint-500');
                btn.classList.add('bg-accent-500', 'hover:bg-accent-600');
                btn.textContent = 'Save Changes';
            }, 1500);
        }
    } catch (e) {
        alert('No internet connection — check your network and try again');
    } finally {
        if (btn) btn.disabled = false;
    }
}
