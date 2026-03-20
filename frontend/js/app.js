/* StudyFlow — Main Application Entry Point (ES6 Module) */

// Global error catcher for debugging blind
window.onerror = function(msg, url, line, col, error) {
    console.error('GLOBAL ERROR:', msg, 'at', url, ':', line, ':', col, error);
    // Only alert for non-extension errors if possible
    if (url.includes('/js/')) {
        alert('Critical error in ' + url.split('/').pop() + ': ' + msg);
    }
};

import { getCurrentUser, setCurrentUser, getAPI, authFetch } from './store.js?v=59';
import { initAuth, handleLogout } from './auth.js?v=59';
import { initTasks, loadExams, checkAuditorDraftOnInit } from './tasks.js?v=59';
import { initRegenerate } from './brain.js?v=59';
import { initInteractions } from './interactions.js?v=59';
import { showScreen, initMobileTabBar, showIosOnboarding, initProfileTabs } from './ui.js?v=59';
import { initPush } from './notifications.js?v=59';
import { registerLoginCheckFlow } from './profile.js?v=59';
import { initOnboarding } from './onboarding.js?v=59';

// Initialize the application
let _dashboardInitialized = false;

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
    try { initProfileTabs(); } catch (e) { console.error('initProfileTabs failed:', e); }
    // NOTE: initPush() is NOT called here. It must run AFTER authentication is confirmed
    // so that authFetch('/push/subscribe') has a valid session cookie. See initDashboard().

    // Verification helper
    const checkAuthAndRoute = async (path, retry = false) => {
        try {
            const API = getAPI();
            const res = await authFetch(`${API}/auth/me`);
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
                initOnboarding();
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
    } else {
        // Check if user is already authenticated (via cookies)
        await checkAuthAndRoute('/');
    }

    // Hide splash screen after initialization
    const hideSplash = () => {
        const splash = document.getElementById('splash-screen');
        if (splash) {
            splash.style.opacity = '0';
            setTimeout(() => {
                splash.style.display = 'none';
            }, 500);
        }
    };
    // Give it a tiny extra buffer for smooth transition
    setTimeout(hideSplash, 300);

    // Android back button: close modals or go back in tab history
    window.addEventListener('popstate', () => {
        // Try to close any open modal first
        const openModal = document.querySelector('.modal-bg.active');
        if (openModal) {
            import('./ui.js?v=59').then(m => m.showModal(openModal.id, false));
            history.pushState(null, '');
            return;
        }
        // If on a non-default tab, switch back to roadmap
        const activeTab = document.querySelector('.mobile-tab-btn.text-accent-400');
        if (activeTab && activeTab.dataset.tab !== 'roadmap') {
            const roadmapBtn = document.querySelector('.mobile-tab-btn[data-tab="roadmap"]');
            if (roadmapBtn) roadmapBtn.click();
            history.pushState(null, '');
        }
    });
    // Push initial state so popstate can fire
    history.pushState(null, '');

    // DEBUG: Viewport diagnostics — tap title bar 3x to show
    let _diagTaps = 0, _diagTimer = null;
    document.getElementById('mobile-tab-title')?.addEventListener('click', () => {
        _diagTaps++;
        clearTimeout(_diagTimer);
        _diagTimer = setTimeout(() => _diagTaps = 0, 800);
        if (_diagTaps >= 3) {
            _diagTaps = 0;
            const db = document.getElementById('screen-dashboard');
            const tb = document.getElementById('mobile-tab-bar');
            const cs = getComputedStyle(db);
            const sai = getComputedStyle(document.documentElement);
            const tbCs = getComputedStyle(tb);
            const bodyCs = getComputedStyle(document.body);
            const bodyAfter = getComputedStyle(document.body, '::after');
            alert([
                `=== v61 diag ===`,
                `innerH: ${window.innerHeight}`,
                `screen: ${screen.height}`,
                `visualVP: ${window.visualViewport ? window.visualViewport.height : 'N/A'}`,
                `--- dashboard ---`,
                `db.offsetH: ${db.offsetHeight}`,
                `db pos: ${cs.position}`,
                `db bottom: ${cs.bottom}`,
                `--- tab bar ---`,
                `tb.offsetH: ${tb.offsetHeight}`,
                `tb pos: ${tbCs.position}`,
                `tb.getBCR.bottom: ${Math.round(tb.getBoundingClientRect().bottom)}`,
                `tb paddingBottom: ${tbCs.paddingBottom}`,
                `tb bg: ${tbCs.backgroundColor}`,
                `--- body ---`,
                `body pos: ${bodyCs.position}`,
                `body h: ${bodyCs.height}`,
                `body::after h: ${bodyAfter.height}`,
                `--- html ---`,
                `html bg: ${getComputedStyle(document.documentElement).backgroundColor}`,
                `standalone: ${window.navigator.standalone}`,
            ].join('\n'));
        }
    });

    // Handle SCROLL_TO_BLOCK event (from notifications)
    window.addEventListener('SCROLL_TO_BLOCK', (e) => {
        const blockId = e.detail ? e.detail.blockId : e.blockId;
        if (!blockId) return;
        
        console.log('App: SCROLL_TO_BLOCK triggered for', blockId);
        
        // Ensure we are on dashboard
        showScreen('screen-dashboard');
        // If mobile, ensure roadmap tab is active
        const roadmapTab = document.querySelector('[data-tab="roadmap"]');
        if (roadmapTab && !roadmapTab.classList.contains('text-accent-400')) {
            roadmapTab.click();
        }

        // Wait for DOM to be ready and rendered
        let attempts = 0;
        const findAndScroll = () => {
            const el = document.getElementById(`block-${blockId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('ring-2', 'ring-accent-500', 'ring-offset-2', 'ring-offset-dark-900', 'z-20');
                setTimeout(() => el.classList.remove('ring-2', 'ring-accent-500', 'ring-offset-2', 'ring-offset-dark-900', 'z-20'), 3000);
            } else if (attempts < 10) {
                attempts++;
                setTimeout(findAndScroll, 200);
            }
        };
        setTimeout(findAndScroll, 500);
    });

    // Check for deep-link in URL on load
    const urlParams = new URLSearchParams(window.location.search);
    const scrollToId = urlParams.get('scrollTo');
    if (scrollToId) {
        console.log('App: deep-link detected in URL, scrolling to', scrollToId);
        // We wait for initial load to finish then trigger the event
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('SCROLL_TO_BLOCK', { detail: { blockId: scrollToId } }));
        }, 1500);
    }

    // Handle global refresh events
    window.addEventListener('calendar-needs-refresh', () => {
        loadExams(handleLogout, true);
    });
}

// Initialize dashboard after successful login
function initDashboard() {
    if (_dashboardInitialized) return;
    _dashboardInitialized = true;

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

    // Gamification: splash screen and morning prompt on first login of day
    try {
        registerLoginCheckFlow();
    } catch (e) {
        console.error('registerLoginCheckFlow failed:', e);
    }

    // Check for stored Auditor draft and offer to resume the review
    checkAuditorDraftOnInit().catch(() => {});

    // Check if iOS onboarding is needed
    showIosOnboarding();

    // Initialize push subscription AFTER authentication is confirmed.
    // This ensures authFetch('/push/subscribe') has a valid session cookie.
    // Calling initPush() before auth completes causes a 401 and leaves
    // push_subscriptions empty, so the scheduler never fires notifications.
    try { initPush(); } catch (e) { console.error('initPush failed:', e); }

    // PWA notification prompt: show on first login when running as an installed
    // PWA (standalone mode) and permission hasn't been asked yet.
    // This handles the case where a user adds the app to their home screen and
    // logs in — there's no task-completion event to trigger the prompt, so we
    // show it proactively a moment after the dashboard loads.
    const isStandalone = window.navigator.standalone === true
        || window.matchMedia('(display-mode: standalone)').matches;
    const hasShownPrompt = localStorage.getItem('sf_notif_prompt_shown') === '1';
    if (
        isStandalone
        && !hasShownPrompt
        && 'Notification' in window
        && Notification.permission === 'default'
    ) {
        setTimeout(() => {
            const modal = document.getElementById('modal-notif-permission');
            if (modal) {
                localStorage.setItem('sf_notif_prompt_shown', '1');
                modal.classList.add('active');
            }
        }, 2000); // short delay so dashboard renders first
    }
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
    // When a new SW takes control (after update), reload to run fresh JS.
    // Without this, the page keeps running stale cached code even after the
    // new SW installs + activates — interactions break because fixes aren't
    // in the running JS bundle. The reload is seamless and instant.
    let _swRefreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (_swRefreshing) return;
        _swRefreshing = true;
        console.log('[SW] New service worker took control — reloading for fresh code');
        window.location.reload();
    });

    const registerSW = () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
            console.log('[SW] Registered, scope:', reg.scope);
        }).catch(err => {
            console.warn('[SW] Registration failed:', err);
        });
    };

    if (document.readyState === 'complete') {
        registerSW();
    } else {
        window.addEventListener('load', registerSW);
    }
}

// PWA: Offline indicator
const offlineBanner = document.getElementById('offline-banner');
function updateOnlineStatus() {
    if (offlineBanner) offlineBanner.style.display = navigator.onLine ? 'none' : 'block';
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus(); // run on load
// Build hash refresh: Thu Feb 26 16:26:30 IST 2026
