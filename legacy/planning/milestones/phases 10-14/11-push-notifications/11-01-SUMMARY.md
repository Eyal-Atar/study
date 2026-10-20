---
phase: 11-push-notifications
plan: 01
subsystem: infra
tags: [pwa, service-worker, manifest, offline, push-notifications, cache-first]

# Dependency graph
requires:
  - phase: 10-manual-edits-regen
    provides: frontend app.js and index.html as target for PWA integration
provides:
  - PWA manifest.json (installable app with standalone display mode)
  - Service Worker sw.js (App Shell caching, offline fallback, push event handler)
  - Offline indicator banner in DOM
  - /manifest.json, /sw.js, /static/* routes in FastAPI server
affects: [11-push-notifications plan 02 (VAPID backend needs SW push handler), future deployment]

# Tech tracking
tech-stack:
  added: [Service Worker API, Web App Manifest, Cache API, Push API]
  patterns: [Cache-first for App Shell assets, Network-first for API routes, Offline-503 fallback for uncached API calls]

key-files:
  created:
    - frontend/manifest.json
    - frontend/sw.js
    - frontend/static/icon-192.png
    - frontend/static/icon-512.png
  modified:
    - frontend/index.html
    - frontend/js/app.js
    - backend/server/__init__.py

key-decisions:
  - "SW registered at /sw.js via explicit FastAPI route with Service-Worker-Allowed header — required because FastAPI does not serve files from root by default"
  - "Cache-first strategy for App Shell assets, network-first for /auth, /tasks, /exams, /users, /brain, /regenerate API routes"
  - "Offline banner uses bg-red-500 not bg-coral-500 — coral-500 is defined in Tailwind config but red-500 is the safer fallback per plan guidance"
  - "SW install error does not fail the installation — addAll failure is caught and logged; SW still activates with skipWaiting"
  - "Icon placeholders are valid 192x192 and 512x512 indigo PNG files generated via Python struct/zlib — valid PWA manifest requirement met"

patterns-established:
  - "Pattern 1: FastAPI serves PWA-critical files (manifest, SW) as explicit routes, not as generic static file mounts, to allow MIME type and header control"
  - "Pattern 2: Service Worker registration block placed after app initialization at module level in app.js, not inside initApp()"

requirements-completed: [INFRA-01, INFRA-03]

# Metrics
duration: 3min
completed: 2026-02-22
---

# Phase 11 Plan 01: Push Notifications PWA Foundation Summary

**PWA manifest + Service Worker with App Shell caching (cache-first), offline indicator, and push event handler wired into FastAPI/Vanilla JS app**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-22T18:09:57Z
- **Completed:** 2026-02-22T18:13:20Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created manifest.json with standalone display mode, indigo theme, and 192/512 icons — enables "Add to Home Screen" in browser
- Built sw.js (152 lines) with install/activate/fetch/push/notificationclick handlers; App Shell cached on install, old caches cleaned on activate
- Push event handler in SW ready for Plan 02 VAPID backend to use
- Added FastAPI routes for /manifest.json, /sw.js with correct MIME types and Service-Worker-Allowed header; /static mount for icons
- Offline indicator banner in index.html, toggled by online/offline events in app.js

## Task Commits

Each task was committed atomically:

1. **Task 1: Create manifest.json and Service Worker (sw.js)** - `045f9c7` (feat)
2. **Task 2: Wire manifest and Service Worker into the app** - `00de468` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `frontend/manifest.json` - PWA manifest: name, display:standalone, theme_color, icons
- `frontend/sw.js` - Service Worker: install/activate/fetch/push/notificationclick, 152 lines
- `frontend/static/icon-192.png` - Valid 192x192 indigo PNG icon placeholder
- `frontend/static/icon-512.png` - Valid 512x512 indigo PNG icon placeholder
- `frontend/index.html` - Added manifest link, theme-color meta, apple-mobile-web-app metas, offline banner div
- `frontend/js/app.js` - Added SW registration on load, online/offline event listeners and updateOnlineStatus()
- `backend/server/__init__.py` - Added /static StaticFiles mount, /manifest.json and /sw.js explicit routes

## Decisions Made
- FastAPI serves `/sw.js` via an explicit route (not StaticFiles) so the `Service-Worker-Allowed: /` header can be set — this is required to grant the SW full app scope
- SW install error is caught and logged but does not fail the install — app still works with partial cache
- API routes use network-first strategy because offline data is stale by definition; 503 JSON `{"offline":true}` returned if both network and cache fail
- Icon files generated as valid PNG via Python struct+zlib to satisfy manifest requirements without external tooling

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added /static StaticFiles mount and explicit PWA routes in server**
- **Found during:** Task 2 (Wire manifest and Service Worker into the app)
- **Issue:** Plan assumed a `/static` serving path existed, but `backend/server/__init__.py` only mounted `/css` and `/js`. Icons at `/static/icon-192.png` would 404 without the mount. Similarly, `/manifest.json` and `/sw.js` needed explicit routes to serve with correct MIME types and Service-Worker-Allowed header.
- **Fix:** Added `app.mount("/static", ...)`, `@app.get("/manifest.json")`, and `@app.get("/sw.js")` with `Service-Worker-Allowed: /` header
- **Files modified:** `backend/server/__init__.py`
- **Verification:** `curl http://localhost:8000/manifest.json` returns valid JSON; `curl http://localhost:8000/sw.js` returns 200; `curl http://localhost:8000/static/icon-192.png` returns 200
- **Committed in:** `00de468` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (missing critical infrastructure)
**Impact on plan:** Fix was necessary for correct PWA operation. Without it, icons would 404 and the SW would fail with wrong scope. No scope creep.

## Issues Encountered
None beyond the auto-fixed static serving issue above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PWA foundation is complete: manifest, SW, offline indicator all functional
- Plan 02 can now implement VAPID backend and push subscription flow — the `push` event handler in sw.js is already wired and ready to receive payloads
- Offline banner is visible but tasks remain editable — Plan may address full offline read-only enforcement in a later plan if needed

---
*Phase: 11-push-notifications*
*Completed: 2026-02-22*
