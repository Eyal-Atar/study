/* frontend/js/auth.js */
import { getAPI, setAuthToken, setCurrentUser, authFetch, resetStore, getCurrentUser } from './store.js?v=AUTO';
import { showRegenBar } from './brain.js?v=AUTO';
import { showScreen, shakeEl, showError, hideError, spawnConfetti } from './ui.js?v=AUTO';

// ─── Push Notification Helpers ───────────────────────────────────────────────

function _urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// subscribeToPush: called ONLY after Notification.permission === 'granted'.
// Permission is requested directly in the onclick handler (index.html) to preserve
// iOS user-gesture context. This function handles VAPID subscription only.
async function subscribeToPush() {
    // Guard: only proceed if permission is already granted.
    // This prevents accidental permission prompts outside a user gesture.
    if (!('Notification' in window) || Notification.permission !== 'granted') {
        console.log('[Push] Skipping subscription — permission not granted');
        return;
    }
    try {
        const API = getAPI();
        // Get VAPID public key
        const keyRes = await authFetch(`${API}/push/vapid-public-key`);
        if (!keyRes.ok) { console.warn('[Push] VAPID key not available'); return; }
        const { key } = await keyRes.json();

        // Subscribe via Service Worker (permission already granted by caller)
        const reg = await navigator.serviceWorker.ready;
        const subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: _urlBase64ToUint8Array(key)
        });

        // Send to backend
        await authFetch(`${API}/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: subscription.toJSON() })
        });
        console.log('[Push] Subscribed successfully');
    } catch (e) {
        console.warn('[Push] Subscription failed:', e);
    }
}

// Listen for push subscription request.
// This event is dispatched ONLY after permission has already been granted
// (from the requestNotificationPermission() global function in index.html).
window.addEventListener('request-push-permission', subscribeToPush);

let onAuthSuccess = () => {};
let onboardingState = {
    hobby: null,
    hobby_other: '',
    wake: '08:00',
    sleep: '23:00',
    hours: 4.0,
    peak: 'Morning'
};

export function initAuth(callbacks = {}) {
    console.log('initAuth: initialization started');
    if (callbacks.onSuccess) onAuthSuccess = callbacks.onSuccess;

    // Welcome screen buttons
    const btnShowRegister = document.getElementById('btn-show-register');
    if (btnShowRegister) {
        console.log('initAuth: btn-show-register found');
        btnShowRegister.onclick = () => showScreen('screen-register');
    }

    const btnShowLogin = document.getElementById('btn-show-login');
    if (btnShowLogin) {
        console.log('initAuth: btn-show-login found');
        btnShowLogin.onclick = () => showScreen('screen-login');
    }

    // Login screen
    const btnLogin = document.getElementById('btn-login');
    if (btnLogin) {
        console.log('initAuth: btn-login found, attaching handleLogin');
        btnLogin.onclick = handleLogin;
    } else {
        console.error('initAuth: btn-login NOT found');
    }

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
    if (btnRegNext2) btnRegNext2.onclick = () => regNext(2);

    const btnRegNext3 = document.getElementById('btn-reg-next-3');
    if (btnRegNext3) btnRegNext3.onclick = () => regNext(3);

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
            if (e.key === 'Enter') regNext(2);
        };
    }

    // Logout button
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) btnLogout.onclick = handleLogout;

    // Onboarding screen button
    // Onboarding wizard bindings
    const onbNext1 = document.getElementById('onb-next-1');
    const onbNext2 = document.getElementById('onb-next-2');
    const onbBack2 = document.getElementById('onb-back-2');
    const onbBack1 = document.getElementById('onb-back-1');
    const onbNextStepNum = document.getElementById('onb-step-num');
    const onbHours = document.getElementById('onb-hours');
    const onbHoursLabel = document.getElementById('onb-hours-label');
    const onbSubmit = document.getElementById('onb-submit');
    const onbDone = document.getElementById('onb-done');

    function showOnbStep(n) {
        for (let i = 1; i <= 3; i++) {
            const el = document.getElementById(`onb-step-${i}`);
            if (el) el.style.display = i === n ? 'block' : 'none';
        }
        const success = document.getElementById('onb-success');
        if (success) success.style.display = 'none';
        if (onbNextStepNum) onbNextStepNum.textContent = String(n);
    }

    // Hobby tags
    document.querySelectorAll('.onb-hobby-tag').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.onb-hobby-tag').forEach(b => b.classList.remove('bg-accent-500/30'));
            btn.classList.add('bg-accent-500/30');
            onboardingState.hobby = btn.dataset.hobby;
            const otherInput = document.getElementById('onb-hobby-other');
            if (onboardingState.hobby === 'Other') {
                if (otherInput) otherInput.style.display = 'block';
            } else {
                if (otherInput) { otherInput.style.display = 'none'; otherInput.value = ''; onboardingState.hobby_other = ''; }
            }
        };
    });

    if (onbHours) {
        onbHours.oninput = () => {
            onboardingState.hours = parseFloat(onbHours.value);
            if (onbHoursLabel) onbHoursLabel.textContent = onboardingState.hours.toFixed(1);
        };
    }

    document.querySelectorAll('.onb-peak-tag').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.onb-peak-tag').forEach(b => b.classList.remove('bg-accent-500/30'));
            btn.classList.add('bg-accent-500/30');
            onboardingState.peak = btn.dataset.peak;
        };
    });

    if (onbNext1) onbNext1.onclick = () => {
        const otherInput = document.getElementById('onb-hobby-other');
        if (onboardingState.hobby === 'Other') {
            if (!otherInput || !otherInput.value.trim()) { if (otherInput) otherInput.focus(); return; }
            onboardingState.hobby_other = otherInput.value.trim();
        }
        showOnbStep(2);
    };

    if (onbBack2) onbBack2.onclick = () => showOnbStep(1);
    if (onbBack1) onbBack1.onclick = () => showOnbStep(1);
    if (onbNext2) onbNext2.onclick = () => showOnbStep(3);

    if (onbSubmit) onbSubmit.onclick = handleOnboardingSubmit;
    if (onbDone) onbDone.onclick = () => { onAuthSuccess(); showScreen('screen-dashboard'); };

    // Settings
    const btnShowSettings = document.getElementById('btn-show-settings');
    const btnCloseSettings = document.getElementById('btn-close-settings');
    const modalSettings = document.getElementById('modal-settings');
    const btnSaveSettings = document.getElementById('btn-save-settings');
    const settingsHours = document.getElementById('settings-hours');
    const settingsHoursLabel = document.getElementById('settings-hours-label');

    if (btnShowSettings) {
        btnShowSettings.onclick = () => {
            const user = getCurrentUser();
            if (!user) return;
            document.getElementById('settings-name').value = user.name || '';
            document.getElementById('settings-hobby').value = user.hobby_name || '';
            document.getElementById('settings-wake').value = user.wake_up_time || '08:00';
            document.getElementById('settings-sleep').value = user.sleep_time || '23:00';
            document.getElementById('settings-hours').value = user.neto_study_hours || 4.0;
            document.getElementById('settings-hours-label').textContent = (user.neto_study_hours || 4.0).toFixed(1);
            document.getElementById('settings-peak').value = user.peak_productivity || 'Morning';
            // Notification preferences
            const notifTiming = document.getElementById('settings-notif-timing');
            if (notifTiming) notifTiming.value = user.notif_timing || 'at_start';
            const notifPerTask = document.getElementById('settings-notif-per-task');
            if (notifPerTask) notifPerTask.checked = (user.notif_per_task ?? 1) === 1;
            const notifDailySummary = document.getElementById('settings-notif-daily-summary');
            if (notifDailySummary) notifDailySummary.checked = (user.notif_daily_summary ?? 0) === 1;
            if (typeof window._updateNotifStatus === 'function') window._updateNotifStatus();
            modalSettings.classList.add('active');
        };
    }

    if (btnCloseSettings) btnCloseSettings.onclick = () => modalSettings.classList.remove('active');
    
    if (settingsHours) {
        settingsHours.oninput = () => {
            if (settingsHoursLabel) settingsHoursLabel.textContent = parseFloat(settingsHours.value).toFixed(1);
        };
    }

    if (btnSaveSettings) btnSaveSettings.onclick = handleSaveSettings;
}

export function regNext(step) {
    if (step === 2) {
        hideError('reg-error-1');
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;
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
    console.log('handleLogin: function triggered');
    const API = getAPI();
    hideError('login-error');
    
    const emailEl = document.getElementById('login-email');
    const passEl = document.getElementById('login-password');
    const btn = document.getElementById('btn-login');

    console.log('handleLogin: elements found:', { emailEl: !!emailEl, passEl: !!passEl, btn: !!btn });

    const email = emailEl ? emailEl.value.trim() : '';
    const password = passEl ? passEl.value : '';
    
    if (!email) { console.log('handleLogin: email missing'); shakeEl('login-email'); return; }
    if (!password) { console.log('handleLogin: password missing'); shakeEl('login-password'); return; }

    if (btn) {
        btn.disabled = true; 
        btn.textContent = 'Logging in...';
    }
    
    console.log('handleLogin: sending request to', `${API}/auth/login`);
    try {
        const res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // Include cookies
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) {
            showError('login-error', data.detail || 'Login failed');
            return;
        }
        // Token is now in HttpOnly cookie, not in response
        setCurrentUser(data.user);
        
        // If onboarding not completed, show onboarding wizard
        if (data.user.onboarding_completed === 0 || data.user.onboarding_completed === null) {
            showScreen('screen-onboarding');
        } else {
            // Show the dashboard screen FIRST to ensure UI transitions even if init fails
            showScreen('screen-dashboard');
            
            // Allow a small delay for cookie to be fully processed by the browser
            // before the next authFetch (in initDashboard/loadExams)
            setTimeout(() => {
                try {
                    console.log('Login successful, initializing dashboard...');
                    onAuthSuccess();
                } catch (err) {
                    console.error('onAuthSuccess failed:', err);
                }
            }, 50);
        }
    } catch (e) {
        console.error('Login error:', e);
        showError('login-error', 'Cannot connect to server');
    } finally {
        btn.disabled = false; btn.textContent = 'Log In';
    }
}

export async function handleRegister() {
    const API = getAPI();
    hideError('reg-error-3');
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const methodEl = document.querySelector('input[name="reg-method"]:checked');
    const method = methodEl ? methodEl.value : 'pomodoro';
    const wake = document.getElementById('reg-wake').value;
    const sleep = document.getElementById('reg-sleep').value;

    const btn = document.getElementById('btn-register');
    btn.disabled = true; btn.textContent = 'Creating...';
    try {
        const res = await fetch(`${API}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // Include cookies
            body: JSON.stringify({
                name, email, password,
                study_method: method,
                wake_up_time: wake,
                sleep_time: sleep,
                session_minutes: method === 'pomodoro' ? 50 : 90,
                break_minutes: method === 'pomodoro' ? 10 : 15,
                timezone_offset: new Date().getTimezoneOffset(),
            }),
        });
        const data = await res.json();
        if (!res.ok) {
            showError('reg-error-3', data.detail || 'Registration failed');
            return;
        }
        // Token is now in HttpOnly cookie, not in response
        setCurrentUser(data.user);
        if (data.user.onboarding_completed === 0 || data.user.onboarding_completed === null) {
            showScreen('screen-onboarding');
        } else {
            onAuthSuccess();
            showScreen('screen-dashboard');
        }
    } catch (e) {
        showError('reg-error-3', 'Cannot connect to server');
    } finally {
        btn.disabled = false; btn.textContent = 'Create Account';
    }
}

export async function handleLogout() {
    const API = getAPI();
    try { await authFetch(`${API}/auth/logout`, { method: 'POST' }); } catch (e) {}
    
    // Close settings modal if open
    const modalSettings = document.getElementById('modal-settings');
    if (modalSettings) modalSettings.classList.remove('active');
    
    resetStore();
    showScreen('screen-welcome');
}

// Submit onboarding data to backend
export async function handleOnboardingSubmit() {
    const API = getAPI();
    // collect latest values
    const otherInput = document.getElementById('onb-hobby-other');
    if (onboardingState.hobby === 'Other' && otherInput) onboardingState.hobby_other = otherInput.value.trim();
    const hobbyValue = onboardingState.hobby === 'Other' ? onboardingState.hobby_other : onboardingState.hobby;
    const wake = document.getElementById('onb-wake') ? document.getElementById('onb-wake').value : onboardingState.wake;
    const sleep = document.getElementById('onb-sleep') ? document.getElementById('onb-sleep').value : onboardingState.sleep;
    const hours = document.getElementById('onb-hours') ? parseFloat(document.getElementById('onb-hours').value) : onboardingState.hours;
    const peak = onboardingState.peak || 'Morning';

    // Show a quick saving state
    const submitBtn = document.getElementById('onb-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    try {
        const payload = {
            hobby_name: hobbyValue,
            neto_study_hours: hours,
            peak_productivity: peak,
            wake_up_time: wake,
            sleep_time: sleep,
            onboarding_completed: 1,
            timezone_offset: new Date().getTimezoneOffset()
        };
        const res = await fetch(`${API}/users/me`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Failed to save profile');
            return;
        }
        const user = await res.json();
        setCurrentUser(user);
        
        // Celebration
        spawnConfetti(submitBtn);

        // show success panel
        document.getElementById('onb-step-1').style.display = 'none';
        document.getElementById('onb-step-2').style.display = 'none';
        document.getElementById('onb-step-3').style.display = 'none';
        const success = document.getElementById('onb-success');
        if (success) {
            success.style.display = 'block';
            success.classList.add('fade-in');
        }
    } catch (e) {
        alert('Network error');
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Finish'; }
    }
}

export async function handleSaveSettings() {
    const API = getAPI();
    const btn = document.getElementById('btn-save-settings');
    btn.disabled = true; btn.textContent = 'Saving...';

    // Capture old hours before save to detect a change
    const oldUser = getCurrentUser();
    const oldHours = oldUser ? (oldUser.neto_study_hours || 0) : 0;

    const newHours = parseFloat(document.getElementById('settings-hours').value);
    const payload = {
        name: document.getElementById('settings-name').value.trim(),
        hobby_name: document.getElementById('settings-hobby').value.trim(),
        wake_up_time: document.getElementById('settings-wake').value,
        sleep_time: document.getElementById('settings-sleep').value,
        neto_study_hours: newHours,
        peak_productivity: document.getElementById('settings-peak').value,
        timezone_offset: new Date().getTimezoneOffset(),
        notif_timing: document.getElementById('settings-notif-timing')?.value || 'at_start',
        notif_per_task: document.getElementById('settings-notif-per-task')?.checked ? 1 : 0,
    };

    try {
        const res = await fetch(`${API}/users/me`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.detail || 'Failed to update settings');
            return;
        }
        const user = await res.json();
        setCurrentUser(user);

        // Update greeting in dashboard
        const greetingEl = document.getElementById('user-greeting');
        if (greetingEl) greetingEl.textContent = `Hey, ${user.name}`;

        document.getElementById('modal-settings').classList.remove('active');

        // Show regen bar if study hours changed
        if (newHours !== oldHours) {
            showRegenBar('Study hours changed — update the schedule if needed.');
        }
    } catch (e) {
        alert('Network error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Changes';
    }
}
