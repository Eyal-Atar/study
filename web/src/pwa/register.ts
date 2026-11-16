// Registers the service worker (src/sw.ts, built to /sw.js). Only in a production build: in
// `npm run dev` a worker would keep serving an old precache over Vite's live modules (decision 15).
// A plain register() instead of virtual:pwa-register: the worker updates itself (skipWaiting and
// clientsClaim), so there is no update prompt to wire, and no workbox-window in the bundle.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  // After the load event, so the worker's precache downloads do not compete with the first render.
  window.addEventListener('load', () => {
    // A failed registration (private mode, blocked storage) leaves the app working without push.
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  })
}
