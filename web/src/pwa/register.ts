// Registers the service worker (src/sw.ts, built to /sw.js). Only in a production build: in
// `npm run dev` a worker would keep serving an old precache over Vite's live modules (decision 15).
// A plain register() instead of virtual:pwa-register: the worker updates itself (skipWaiting and
// clientsClaim), so there is no update prompt to wire, and no workbox-window in the bundle.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  reloadOnUpdate(navigator.serviceWorker, () => {
    window.location.reload()
  })
  // After the load event, so the worker's precache downloads do not compete with the first render.
  window.addEventListener('load', () => {
    // A failed registration (private mode, blocked storage) leaves the app working without push.
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined)
  })
}

// An older worker served this page from its precache. When a new release's worker takes over
// (skipWaiting + clientsClaim), the page still runs the old code until it reloads: reload once, so a
// broken release is replaced on the next open and not one open later (S16, the iPhone report). The
// first install (no controller yet) does not reload: that page already runs the current code.
export function reloadOnUpdate(
  container: Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>,
  reload: () => void,
): void {
  if (container.controller === null) return
  let reloaded = false
  container.addEventListener('controllerchange', () => {
    if (reloaded) return
    reloaded = true
    reload()
  })
}
