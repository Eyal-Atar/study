# Phase 5 Context: Frontend Modularization

## Architectural Decisions

### 1. Module Boundaries
- **Pattern:** Feature-based ES6 modules.
- **Ownership:** Each module (e.g., `auth.js`, `calendar.js`, `tasks.js`) owns both its business logic and its specific DOM updates. This keeps feature-related code localized and easier to maintain.
- **Exports:** Modules should export an explicit `init()` function and necessary getter/setter functions. Avoid exporting raw DOM elements.

### 2. State Management
- **Store:** A dedicated `store.js` module will act as a centralized, reactive-ready data container.
- **Shared Data:** Global state (e.g., `currentUser`, `activeExam`, `currentTasks`) must be stored in `store.js`.
- **Access:** Other modules import `store.js` to read or update state. No direct manipulation of global `window` objects.

### 3. Initialization Flow
- **Entry Point:** `app.js` serves as the single entry point.
- **Orchestration:** `app.js` imports all feature modules and calls their `init()` functions in a controlled sequence (e.g., Auth must initialize before Calendar).
- **Async Handling:** The `init()` sequence in `app.js` will handle `async/await` for modules requiring network calls (like checking auth status) before proceeding to render the UI.

### 4. Error Handling & Feedback
- **Notification Module:** A shared `ui.js` or `notify.js` module will provide standardized methods for alerts, toasts, and confirmation dialogs.
- **Consistency:** All modules must use this shared service for user feedback to ensure a unified UX.

## Constraints
- **No Build Step:** Must remain compatible with CDN-based Tailwind and native browser ES6 module support.
- **Brownfield Compatibility:** The refactor must preserve all existing functionality (login, exam management, task tracking) without breaking the backend integration.
