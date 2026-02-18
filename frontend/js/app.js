/* StudyFlow — Main Application Entry Point (ES6 Module) */

import { getAuthToken, getCurrentUser, setCurrentUser, getAPI } from './store.js';
import { initAuth, handleLogout } from './auth.js';
import { initTasks, loadExams } from './tasks.js';
import { initBrain } from './brain.js';
import { showScreen } from './ui.js';

// Initialize the application
async function initApp() {
    const authToken = getAuthToken();

    // Set up authentication callbacks
    initAuth({
        onSuccess: () => {
            initDashboard();
        }
    });

    // Initialize feature modules
    initTasks();
    initBrain();

    // Check if user is already authenticated
    if (authToken) {
        try {
            const API = getAPI();
            const res = await fetch(`${API}/auth/me`, {
                headers: { 'Authorization': `Bearer ${authToken}` },
            });
            if (!res.ok) throw new Error('Not authenticated');
            const user = await res.json();
            setCurrentUser(user);
            initDashboard();
            showScreen('screen-dashboard');
        } catch (e) {
            localStorage.removeItem('studyflow_token');
            showScreen('screen-welcome');
        }
    } else {
        showScreen('screen-welcome');
    }
}

// Initialize dashboard after successful login
function initDashboard() {
    const user = getCurrentUser();
    const greetingEl = document.getElementById('user-greeting');
    const avatarEl = document.getElementById('user-avatar');

    if (greetingEl) greetingEl.textContent = `Hey, ${user.name}`;
    if (avatarEl) avatarEl.textContent = user.name[0].toUpperCase();

    loadExams(handleLogout);
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
