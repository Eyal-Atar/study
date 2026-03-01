/* StudyFlow — Notifications & Push Module */
import { getAPI, authFetch } from './store.js?v=AUTO';

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
    console.log('[PUSH] initPush: checking support...');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[PUSH] Push notifications not supported');
        return;
    }

    if (!('Notification' in window) || Notification.permission !== 'granted') {
        console.log('[PUSH] initPush: permission NOT granted (state: ' + (window.Notification ? Notification.permission : 'N/A') + '), skipping auto-refresh');
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;
        console.log('[PUSH] ServiceWorker ready, scope:', registration.scope);
        const existing = await registration.pushManager.getSubscription();

        if (!existing) {
            console.log('[PUSH] initPush: no existing subscription, creating one...');
            await subscribeToPush();
            return;
        }

        console.log('[PUSH] initPush: existing subscription found:', existing.endpoint);
        const keyMatch = await checkVapidKeyMatch(existing);
        if (!keyMatch) {
            console.log('[PUSH] initPush: VAPID key mismatch, re-subscribing...');
            try {
                await existing.unsubscribe();
            } catch (unsubErr) {
                console.warn('[PUSH] Failed to unsubscribe old subscription:', unsubErr);
            }
            await subscribeToPush();
            return;
        }

        console.log('[PUSH] initPush: VAPID key matches, syncing to backend...');
        await saveSubscription(existing);
    } catch (err) {
        console.error('[PUSH] initPush failed:', err);
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
        if (!response.ok) {
            console.warn('checkVapidKeyMatch: Failed to fetch VAPID key from server. Defaulting to re-subscribe.');
            return false;
        }
        const { key: serverKeyBase64 } = await response.json();

        // 1. Check against localStorage first. This is our primary source of truth
        // for what key we actually used during our last successful subscribeToPush()
        // call, especially on browsers where subscription.options is null.
        const storedKey = localStorage.getItem('sf-push-vapid-key');
        if (storedKey && storedKey !== serverKeyBase64) {
            console.log('checkVapidKeyMatch: VAPID key mismatch (stored in localStorage)');
            return false;
        }

        // 2. Double check the subscription object itself if applicationServerKey is available.
        const subKey = subscription.options && subscription.options.applicationServerKey;
        if (subKey) {
            const serverKeyArray = urlBase64ToUint8Array(serverKeyBase64);
            const subKeyArray = new Uint8Array(subKey);
            
            let match = true;
            if (serverKeyArray.length !== subKeyArray.length) {
                match = false;
            } else {
                for (let i = 0; i < serverKeyArray.length; i++) {
                    if (serverKeyArray[i] !== subKeyArray[i]) {
                        match = false;
                        break;
                    }
                }
            }

            if (!match) {
                console.log('checkVapidKeyMatch: VAPID key mismatch (subscription.options)');
                return false;
            }

            // If we have a subKey and it matches, ensure localStorage is populated
            // for future checks even if it was previously empty.
            if (!storedKey) {
                localStorage.setItem('sf-push-vapid-key', serverKeyBase64);
            }
        } else if (!storedKey) {
            // No stored key AND no accessible subKey in subscription options.
            // We have a subscription but no way to verify its key. To be safe,
            // we force a re-subscribe once to establish a known state.
            console.log('checkVapidKeyMatch: No VAPID key found in subscription or localStorage. Forcing re-subscribe to establish baseline.');
            return false;
        }

        return true;
    } catch (err) {
        console.error('checkVapidKeyMatch failed:', err);
        // Force re-subscribe on error to ensure we eventually reach a valid state.
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
    console.log('subscribeToPush: started');
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('Push notifications are not supported on this browser.');
        return;
    }

    // Step 1: Ensure Notification permission is granted (iOS requires this before push subscribe)
    if (!('Notification' in window)) {
        console.warn('subscribeToPush: Notification API unavailable (not standalone PWA?)');
        return;
    }

    if (Notification.permission !== 'granted') {
        console.log('subscribeToPush: requesting Notification permission...');
        const permission = await Notification.requestPermission();
        console.log('subscribeToPush: permission result:', permission);
        if (permission !== 'granted') {
            console.warn('subscribeToPush: permission not granted, aborting push subscription');
            return;
        }
    }

    try {
        console.log('subscribeToPush: waiting for SW ready...');
        const registration = await navigator.serviceWorker.ready;
        console.log('subscribeToPush: SW ready, scope:', registration.scope);

        // Unsubscribe any existing subscription first.
        // This forces a fresh subscription with the current VAPID key.
        // Without this, a stale subscription (created with an old key) causes
        // Apple/Google to return 401/403 "BadJwtToken" on every push attempt.
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
            console.log('subscribeToPush: unsubscribing stale subscription before re-subscribing...');
            await existing.unsubscribe();
        }

        // Step 2: Get public VAPID key from backend
        console.log('subscribeToPush: fetching VAPID key...');
        const response = await authFetch(`${getAPI()}/push/vapid-public-key`);
        if (!response.ok) throw new Error('Failed to fetch VAPID key: ' + response.status);
        const { key } = await response.json();
        console.log('subscribeToPush: VAPID key received');

        // Step 3: Subscribe with VAPID
        console.log('subscribeToPush: calling PushManager.subscribe...');
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key)
        });

        console.log('subscribeToPush: subscribed successfully:', subscription.endpoint);
        localStorage.setItem('sf-push-vapid-key', key);
        await saveSubscription(subscription);

        return subscription;
    } catch (err) {
        console.error('subscribeToPush: failed:', err);
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

        if (!response.ok) throw new Error('Failed to save subscription: ' + response.status);
        console.log('Push subscription saved/synced to backend');
    } catch (err) {
        console.error('Error saving push subscription:', err);
    }
}

/**
 * Show an in-app toast notification.
 */
export function showToast(title, body, blockId = null) {
    console.log('showToast:', title, body, blockId);

    // Remove existing toast if any
    const existing = document.getElementById('sf-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'sf-toast';
    // Style matches typical StudyFlow UI
    toast.className = 'fixed top-6 right-6 z-[100] w-full max-w-xs bg-dark-700/90 backdrop-blur-md border border-white/10 rounded-2xl p-4 shadow-2xl animate-slide-in cursor-pointer';

    toast.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="w-10 h-10 rounded-xl bg-accent-500/20 flex items-center justify-center text-xl shrink-0">🧠</div>
            <div class="flex-1 overflow-hidden">
                <div class="font-bold text-sm truncate text-white">${title}</div>
                <div class="text-white/50 text-xs line-clamp-2">${body}</div>
            </div>
            <button class="text-white/20 hover:text-white p-1" onclick="this.closest('#sf-toast').remove()">✕</button>
        </div>
    `;

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
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'PUSH_RECEIVED') {
            showToast(event.data.title, event.data.body, event.data.blockId);
        }
        if (event.data && event.data.type === 'SCROLL_TO_BLOCK') {
            window.dispatchEvent(new CustomEvent('SCROLL_TO_BLOCK', { detail: { blockId: event.data.blockId } }));
        }
    });
}

// Handle global push request event (dispatched from index.html scripts)
window.addEventListener('request-push-permission', () => {
    subscribeToPush().catch(err => console.error('Push subscription failed:', err));
});
