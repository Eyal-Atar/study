# Phase 16: PWA Push Notifications, iOS Onboarding, and Smart Triggers - Context

## Phase Boundary
Establishing a robust communication bridge between the server and the user's device. This phase enables the PWA to act as a native application by registering for system-level notifications, providing an "Add to Home Screen" onboarding flow for iOS, and implementing time-sensitive push triggers for daily tasks and AI-generated schedules.

## Implementation Decisions

### PWA Registration & iOS Onboarding
- **Environment Detection:** Logic to detect if the app is running in standalone mode or via a mobile browser (Safari/Chrome).
- **iOS Instruction Overlay:** A guided UI overlay for iOS users explaining the "Add to Home Screen" process (Share -> Add to Home Screen) as a prerequisite for notifications.
- **Permission Trigger:** `Notification.requestPermission()` is called immediately upon the first launch from the Home Screen.

### Notification Triggers & Logic
- **Task Reminders:** Push notification sent 2 minutes before a task's scheduled start time.
- **Schedule Readiness:** Instant push notification sent once the AI completes the "Roadmap" generation.
- **Foreground Handling:** If the app is open (Foreground), system banners are suppressed in favor of internal UI visual cues (e.g., flashing task card or toast message).

### Service Worker & Backend Integration
- **Push Listener:** Service Worker (`sw.js`) implementation to listen for 'push' events and display `showNotification` banners even when the browser/app is closed.
- **Subscription Management:** Securely sending the VAPID subscription object to the backend to link the device token with the user's account.
- **Auto-Scroll Integration:** Ensuring the notification system works in tandem with the Roadmap's 24-hour layout, allowing users to tap a notification and be directed to the specific task location.

### Data & Connectivity
- **VAPID Keys:** Implementation of voluntary application server identification for secure push delivery.
- **Offline Resilience:** Service Worker caches notification assets to ensure icons and titles render correctly without immediate network access.

## Specific Ideas
- **"WhatsApp Style" Delivery:** Notifications must appear as standard system banners to give the app a "Real-time" feel.
- **Two-Minute Warning:** Specifically chosen to give users enough time to transition between activities without being too early.
- **Visual Cues only in-app:** Maintaining a clean UX by not double-notifying the user when they are already looking at the Roadmap.
- **Full 24-Hour Scope:** Notifications should trigger for any task regardless of the "Wake/Sleep" hour settings, treating the entire day as an interactive playground.

## Claude's Discretion (Guidance for Research/Planning)
- Exact design and animation of the iOS "Add to Home Screen" instruction overlay.
- Visual style of the "Foreground" notification cue (Toast, Glow, or Badge).
- Frequency of "Re-ask" logic if a user denies notification permissions.

## Deferred Ideas
- **Snooze Button:** Direct "Snooze" action from the notification banner (moved to future phase).
- **Sound Customization:** Custom notification sounds for different task categories.
