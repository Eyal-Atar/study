/* StudyFlow — Main Application Entry Point (ES6 Module) */

// Global error catcher for debugging blind
window.onerror = function(msg, url, line, col, error) {
    console.error('GLOBAL ERROR:', msg, 'at', url, ':', line, ':', col, error);
    // Only alert for non-extension errors if possible
    if (url.includes('/js/')) {
        alert('Critical error in ' + url.split('/').pop() + ': ' + msg);
    }
};

import { getCurrentUser, setCurrentUser, getAPI } from './store.js?v=31';
import { initAuth, handleLogout } from './auth.js?v=31';
import { initTasks, loadExams } from './tasks.js?v=31';
import { initRegenerate } from './brain.js?v=31';
import { initInteractions } from './interactions.js?v=41';
import { showScreen, initMobileTabBar } from './ui.js?v=31';

// Initialize the application
async function initApp() {
    console.log('initApp: starting...');
    // Set up authentication callbacks
    initAuth({
        onSuccess: () => {
            console.log('initApp: auth onSuccess triggered');
            initDashboard();
        }
    });

    // Initialize feature modules
    console.log('initApp: initializing features...');
    try { initTasks(); } catch (e) { console.error('initTasks failed:', e); }
    try { initRegenerate(); } catch (e) { console.error('initRegenerate failed:', e); }
    try { initInteractions(); } catch (e) { console.error('initInteractions failed:', e); }
    try { initMobileTabBar(); } catch (e) { console.error('initMobileTabBar failed:', e); }

    // Verification helper
    const checkAuthAndRoute = async (path, retry = false) => {
        try {
            const API = getAPI();
            const res = await fetch(`${API}/auth/me`, {
                credentials: 'include', // Include cookies
            });
            if (!res.ok) {
                if (!retry) {
                    // Retry once after a short delay (cookie might not be ready)
                    await new Promise(resolve => setTimeout(resolve, 100));
                    return checkAuthAndRoute(path, true);
                }
                throw new Error('Not authenticated');
            }
            const user = await res.json();
            setCurrentUser(user);
            
            // Check onboarding status
            if (user.onboarding_completed === 0 || user.onboarding_completed === null) {
                showScreen('screen-onboarding');
            } else if (path === '/onboarding') {
                // Already completed onboarding but landed on /onboarding
                initDashboard();
                showScreen('screen-dashboard');
            } else {
                initDashboard();
                showScreen('screen-dashboard');
            }
        } catch (e) {
            console.error('Auth check failed:', e);
            showScreen('screen-welcome');
        }
    };

    // Check URL for routing
    const path = window.location.pathname;
    if (path === '/onboarding' || path === '/dashboard') {
        await checkAuthAndRoute(path);
        return;
    }

    // Check if user is already authenticated (via cookies)
    await checkAuthAndRoute('/');

    // Handle global refresh events
    window.addEventListener('calendar-needs-refresh', () => {
        loadExams(handleLogout);
    });
}

// Initialize dashboard after successful login
function initDashboard() {
    const user = getCurrentUser();
    if (!user) {
        console.warn('initDashboard: No user found');
        return;
    }

    const greetingEl = document.getElementById('user-greeting');
    const avatarEl = document.getElementById('user-avatar');

    if (greetingEl) greetingEl.textContent = `Hey, ${user.name || 'Student'}`;
    
    if (avatarEl && user.name) {
        // Safe access to first character for Hebrew or any other script
        const firstChar = Array.from(user.name)[0];
        const initial = (firstChar || '?').toUpperCase();
        avatarEl.textContent = initial;
        const mobileAvatarEl = document.getElementById('mobile-user-avatar');
        if (mobileAvatarEl) mobileAvatarEl.textContent = initial;
    }

    loadExams(handleLogout);
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initApp().catch(err => {
            console.error('CRITICAL: app.js initApp failed during DOMContentLoaded:', err);
        });
    });
} else {
    initApp().catch(err => {
        console.error('CRITICAL: app.js initApp failed immediately:', err);
    });
}

// PWA: Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            console.log('[SW] Registered:', reg.scope);
        }).catch(err => {
            console.warn('[SW] Registration failed:', err);
        });
    });
}

// PWA: Offline indicator
const offlineBanner = document.getElementById('offline-banner');
function updateOnlineStatus() {
    if (offlineBanner) offlineBanner.style.display = navigator.onLine ? 'none' : 'block';
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus(); // run on load
