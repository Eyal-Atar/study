/// <reference lib="webworker" />
import { clientsClaim } from 'workbox-core'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { clickTarget, readPushPayload } from './pwa/notification'

// The service worker (decision 14), built by vite-plugin-pwa (injectManifest) to dist/sw.js.
// It precaches the hashed build and serves index.html for every navigation, and shows reminders.
// The API is on another origin, so the worker never touches its requests.

declare let self: ServiceWorkerGlobalScope

// The build writes the list of hashed files here; a new build replaces the old precache.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

// A new version takes over at once; the page keeps its loaded code and runs the new one on the
// next load, so nothing reloads in the middle of onboarding.
self.addEventListener('install', () => {
  void self.skipWaiting()
})
clientsClaim()

function pushData(event: PushEvent): unknown {
  try {
    return event.data?.json()
  } catch {
    // Not JSON: show the generic reminder rather than nothing.
    return undefined
  }
}

self.addEventListener('push', (event) => {
  const { title, options } = readPushPayload(pushData(event))
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = clickTarget(event.notification.data, self.location.origin)
  event.waitUntil(openApp(url))
})

// Brings an open window of the app forward on the reminder's page, or opens a new one.
async function openApp(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
  if (open !== undefined) {
    const focused = await open.focus()
    // navigate() works only on a window this worker controls; otherwise the focused window stays.
    await focused.navigate(url).catch(() => undefined)
    return
  }
  await self.clients.openWindow(url)
}
