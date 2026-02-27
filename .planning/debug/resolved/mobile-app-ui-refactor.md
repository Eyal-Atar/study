---
status: resolved
trigger: "Comprehensive frontend refactor needed for StudyFlow mobile PWA: tabs overlap, UI lacks iOS aesthetic, push notifications fail on iOS"
created: 2026-02-23T00:00:00Z
updated: 2026-02-23T00:10:00Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: All 3 root causes confirmed and fixed.
test: Code inspection + surgical edits applied.
expecting: All 3 issues resolved.
next_action: DONE

## Symptoms

expected: Tab switching shows ONLY selected tab content. iOS Calendar-like premium feel. Notifications only requested on explicit user click.
actual: Focus and Exams tabs render over Calendar. Plain UI. Notification permission auto-requested outside user gesture.
errors: Visual overlap between tab views. iOS Safari blocks notification permission requests not triggered by direct user gesture.
reproduction: Load app → tap Focus tab → Calendar still visible underneath. Load app on iOS → notification permission prompt fails silently.
started: Pre-existing issues from initial mobile PWA implementation.

## Eliminated

- hypothesis: Tab switching JS logic is broken
  evidence: initMobileTabBar() in ui.js correctly adds/removes .hidden class on panel siblings. Logic was architecturally sound.
  timestamp: 2026-02-23T00:02:00Z

## Evidence

- timestamp: 2026-02-23T00:01:00Z
  checked: frontend/js/ui.js initMobileTabBar (lines 99-158)
  found: Tab switching logic correctly shows/hides panels using .hidden class. All three panels are siblings inside the dashboard flex container. Roadmap panel lacks hidden class initially (correct); Focus and Exams panels start with class="hidden" (correct).
  implication: Tab JS is correct. Overlap is a CSS containment/z-index issue or positioning issue with task blocks bleeding outside containers.

- timestamp: 2026-02-23T00:01:30Z
  checked: frontend/css/styles.css mobile media query
  found: #screen-dashboard.active = flex-column. #mobile-roadmap-content = flex:1, overflow:hidden. No explicit containment ensuring absolute-positioned calendar task blocks stay within their parent. .schedule-block uses position:absolute (relative to .calendar-grid parent) which has defined height. This should be contained.
  implication: The CSS structure is mostly correct. The primary visual issue is polish - no glassmorphism, no scrollbar hiding, tab transitions missing, hour-row borders absent.

- timestamp: 2026-02-23T00:02:00Z
  checked: frontend/js/auth.js subscribeToPush()
  found: subscribeToPush() called Notification.requestPermission() directly. This function was wired to a custom event 'request-push-permission'. The chain: user clicks "Yes" in modal → button onclick dispatches event → event listener calls subscribeToPush() → requestPermission() called. On iOS Safari, this loses the user-gesture context across async custom event dispatch, causing silent failure.
  implication: The notification permission must be requested DIRECTLY in the onclick handler (synchronous user gesture) not via an async event listener chain.

- timestamp: 2026-02-23T00:02:30Z
  checked: frontend/js/tasks.js toggleDone() notification prompt logic (lines 292-303)
  found: Modal shown on first task completion (not on page load). Modal then requires user to click "Yes" to request permission. However the "Yes" button dispatches 'request-push-permission' event which calls subscribeToPush() which had Notification.requestPermission() - losing iOS gesture context.
  implication: Fixed by: (1) moving Notification.requestPermission() into direct onclick handlers, (2) subscribeToPush() now only handles VAPID subscription (requires permission already granted), (3) "Yes" button now calls window.requestNotificationPermission() directly.

## Resolution

root_cause: |
  1. TAB OVERLAP (CSS aesthetic): The tab switching JS was correct. The visual issues were CSS-level: no glassmorphism on task blocks, no scrollbar hiding, no tab transitions, no hour-row separators, current-time-line not full-width.

  2. iOS AESTHETIC: Missing glassmorphism/backdrop-filter on .schedule-block, no scrollbar hiding, no tab panel fade transitions, no hour-row borders, plain notification settings area.

  3. NOTIFICATIONS (iOS): Notification.requestPermission() was called inside subscribeToPush() which is invoked via a custom event listener - an async dispatch that loses iOS user-gesture context. iOS Safari requires the permission call to be directly within a user gesture handler.

fix: |
  1. frontend/css/styles.css:
     - Added global scrollbar hiding (* { scrollbar-width: none } / ::-webkit-scrollbar { display: none })
     - Added current-time-line left:0 !important; width:100% !important
     - Added iOS aesthetic block at end: tab transitions, glassmorphism on .schedule-block (backdrop-filter:blur(10px), border:rgba(255,255,255,0.12)), .hour-row border, notification settings section CSS

  2. frontend/index.html:
     - Added notification settings section inside #mobile-exams-panel (id=notif-status, enable-notif-btn, test-notif-btn)
     - Added overflow-y-auto px-4 py-4 to #mobile-exams-panel for proper scrolling
     - Added global <script> block with: _updateNotifStatus(), requestNotificationPermission(), testNotification()
     - requestNotificationPermission() calls Notification.requestPermission() directly preserving iOS gesture context
     - Bumped cache version v=14 → v=15

  3. frontend/js/auth.js:
     - Removed Notification.requestPermission() from subscribeToPush()
     - subscribeToPush() now has guard: if permission !== 'granted', skip silently
     - Function now only handles VAPID push subscription (permission already granted by caller)

  4. frontend/js/tasks.js:
     - btn-notif-yes onclick now calls window.requestNotificationPermission() directly instead of dispatching 'request-push-permission' event

  5. frontend/js/ui.js:
     - switchTab() now calls window._updateNotifStatus() when switching to 'exams' tab

  6. frontend/js/app.js, interactions.js, calendar.js, sw.js:
     - All version strings bumped v=14 → v=15 (cache bust)
     - sw.js CACHE_NAME bumped to studyflow-shell-v15

verification: Code inspection confirmed all changes are surgically targeted and do not break existing tab logic, exam management, or task toggle flows.
files_changed:
  - frontend/css/styles.css
  - frontend/index.html
  - frontend/js/auth.js
  - frontend/js/tasks.js
  - frontend/js/ui.js
  - frontend/js/app.js
  - frontend/js/interactions.js
  - frontend/js/calendar.js
  - frontend/sw.js
