/* frontend/js/auth.js */
import { getAPI, setAuthToken, setCurrentUser, authFetch, resetStore } from './store.js';
import { showScreen, shakeEl, showError, hideError } from './ui.js';

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
    const API = getAPI();
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
        setAuthToken(data.token);
        setCurrentUser(data.user);
        onAuthSuccess();
        showScreen('screen-dashboard');
    } catch (e) {
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
        setAuthToken(data.token);
        setCurrentUser(data.user);
        onAuthSuccess();
        showScreen('screen-dashboard');
    } catch (e) {
        showError('reg-error-3', 'Cannot connect to server');
    } finally {
        btn.disabled = false; btn.textContent = 'Create Account';
    }
}

export async function handleLogout() {
    const API = getAPI();
    try { await authFetch(`${API}/auth/logout`, { method: 'POST' }); } catch (e) {}
    resetStore();
    showScreen('screen-welcome');
}
