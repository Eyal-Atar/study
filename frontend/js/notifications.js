/* StudyFlow — Notifications & Push Module */
import { getAPI, authFetch } from './store.js?v=59';

/**
 * Initialize Push Notifications for the current user.
 * Called after successful authentication (from initDashboard in app.js).
 *
 * Strategy:
 *  - If no browser subscription exists, create one and save to backend.
 *  - If a browser subscription exists, re-save it to the backend (upsert).
 *    This is idempotent and ensures the DB record stays in sync after
 *    backend DB resets or VAPID rotation cleanup events.
 *  - We do NOT force-unsubscribe on every load. Doing so creates a window
 *    where any network failure leaves push_subscriptions empty, which makes
 *    the scheduler unable to find any user and notifications never fire.
 */
export async function initPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();

        if (!existing) {
            await subscribeToPush();
            return;
        }

        const keyMatch = await checkVapidKeyMatch(existing);
        if (!keyMatch) {
            try { await existing.unsubscribe(); } catch (_) {}
            await subscribeToPush();
            return;
        }

        await saveSubscription(existing);
    } catch (err) {
        console.error('Push init failed:', err);
    }
}

/**
 * Check if the existing push subscription's applicationServerKey matches the
 * server's current VAPID public key. Returns false if keys don't match,
 * meaning we need to re-subscribe.
 */
async function checkVapidKeyMatch(subscription) {
    try {
        const response = await authFetch(`${getAPI()}/push/vapid-public-key`);
        if (!response.ok) return false;
        const { key: serverKeyBase64 } = await response.json();

        const storedKey = localStorage.getItem('sf-push-vapid-key');
        if (storedKey && storedKey !== serverKeyBase64) return false;

        const subKey = subscription.options && subscription.options.applicationServerKey;
        if (subKey) {
            const serverKeyArray = urlBase64ToUint8Array(serverKeyBase64);
            const subKeyArray = new Uint8Array(subKey);

            let match = true;
            if (serverKeyArray.length !== subKeyArray.length) {
                match = false;
            } else {
                for (let i = 0; i < serverKeyArray.length; i++) {
                    if (serverKeyArray[i] !== subKeyArray[i]) { match = false; break; }
                }
            }

            if (!match) return false;
            if (!storedKey) localStorage.setItem('sf-push-vapid-key', serverKeyBase64);
        } else if (!storedKey) {
            return false;
        }

        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Subscribe the user to push notifications using VAPID.
 * Must be called from a user gesture context (e.g. button click handler).
 * Explicitly requests Notification permission before attempting PushManager.subscribe —
 * iOS 16.4+ requires permission to be granted first, and will silently fail otherwise.
 */
export async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!('Notification' in window)) return;

    if (Notification.permission !== 'granted') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;

        const existing = await registration.pushManager.getSubscription();
        if (existing) await existing.unsubscribe();

        const response = await authFetch(`${getAPI()}/push/vapid-public-key`);
        if (!response.ok) throw new Error('Could not set up notifications');
        const { key } = await response.json();

        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key)
        });

        localStorage.setItem('sf-push-vapid-key', key);
        await saveSubscription(subscription);

        return subscription;
    } catch (err) {
        console.error('Push subscription failed:', err);
        throw err;
    }
}

/**
 * Save (or re-save) a PushSubscription to the backend.
 * The backend upserts on endpoint conflict, so this is safe to call
 * both for new subscriptions and to sync an existing one.
 */
async function saveSubscription(subscription) {
    const API = getAPI();
    const deviceName = getDeviceName();

    try {
        const response = await authFetch(`${API}/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription: subscription.toJSON ? subscription.toJSON() : subscription,
                device_name: deviceName
            })
        });

        if (!response.ok) throw new Error('Failed to save subscription');
    } catch (err) {
        console.error('Error saving push subscription:', err);
    }
}

/**
 * Show an in-app toast notification.
 */
export function showToast(title, body, blockId = null) {

    // Remove existing toast if any
    const existing = document.getElementById('sf-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'sf-toast';
    // Style matches typical StudyFlow UI
    toast.className = 'fixed top-6 right-6 z-[100] w-full max-w-xs bg-dark-700/90 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-2xl animate-slide-in cursor-pointer';

    const row = document.createElement('div');
    row.className = 'flex items-start gap-3';

    const icon = document.createElement('div');
    icon.className = 'w-10 h-10 rounded-xl bg-accent-500/20 flex items-center justify-center text-xl shrink-0';
    icon.textContent = '🧠';

    const content = document.createElement('div');
    content.className = 'flex-1 overflow-hidden';
    const titleEl = document.createElement('div');
    titleEl.className = 'font-bold text-sm truncate text-white';
    titleEl.textContent = title;
    const bodyEl = document.createElement('div');
    bodyEl.className = 'text-white/50 text-xs line-clamp-2';
    bodyEl.textContent = body;
    content.appendChild(titleEl);
    content.appendChild(bodyEl);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'text-white/20 hover:text-white p-1';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => toast.remove();

    row.appendChild(icon);
    row.appendChild(content);
    row.appendChild(closeBtn);
    toast.appendChild(row);

    toast.onclick = (e) => {
        if (e.target.closest('button')) return;
        if (blockId) {
            window.dispatchEvent(new CustomEvent('SCROLL_TO_BLOCK', { detail: { blockId } }));
        }
        toast.classList.replace('animate-slide-in', 'animate-slide-out');
        setTimeout(() => toast.remove(), 300);
    };

    document.body.appendChild(toast);

    // Auto-remove after 6 seconds
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.replace('animate-slide-in', 'animate-slide-out');
            setTimeout(() => toast.remove(), 300);
        }
    }, 6000);
}

// Helper: Convert VAPID key
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Helper: Get human-readable device name
function getDeviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android Device';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows PC';
    return 'Web Browser';
}

// Listen for messages from Service Worker
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async event => {
        if (!event.data) return;

        if (event.data.type === 'PUSH_RECEIVED') {
            showToast(event.data.title, event.data.body, event.data.blockId);
        }

        if (event.data.type === 'SCROLL_TO_BLOCK') {
            window.dispatchEvent(new CustomEvent('SCROLL_TO_BLOCK', { detail: { blockId: event.data.blockId } }));
        }
    });
}

// Handle global push request event (dispatched from index.html scripts)
window.addEventListener('request-push-permission', () => {
    subscribeToPush().catch(err => console.error('Push subscription failed:', err));
});
