# Phase 21: User Onboarding & Exam Generation Loop - Research

**Researched:** 2026-03-06
**Domain:** UX Onboarding, Multi-step Wizard, State Persistence, Material-based Scheduling
**Confidence:** HIGH

## Summary

Phase 21 focuses on transforming the first-time user experience from a scattered setup into a cohesive, high-conversion "Exam Generation Loop." The research confirms that the current codebase uses a vanilla JS module pattern with Tailwind CSS. The onboarding flow will utilize progressive disclosure, ensuring users are never overwhelmed by more than one question at a time. Local storage will act as a safety net for session persistence, while the backend will be upgraded to anchor specific study tasks (Simulations/Reviews) based on uploaded material types (Past Exams/Syllabi).

**Primary recommendation:** Use a "State-Machine" approach for the onboarding wizard to manage visibility and validation, persisting progress to `localStorage` at every step, and replace the legacy `regenerate-delta` endpoint with a unified `generate-roadmap` flow that respects material weights.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Preset choices (Chips/Buttons)** only for profiling (Study Hours, Buffer Days).
- **Local Storage** for dropout recovery; backend sync only on final "Create" button.
- **Mandatory Material Upload (1-3 files)** with React (Vanilla) validation.
- **Fixed Weights** for materials: Past Exams (3h, final days), Syllabus (1.5h, first day).
- **Real-time AI progress steps** on the transition screen.
- **Removal of Legacy Regeneration** mechanism entirely.

### Claude's Discretion
- UX/UI implementation of progressive disclosure.
- Exact micro-interactions for the transition screen.
- Codebase refactoring strategy for removing legacy brain logic.

### Deferred Ideas (OUT OF SCOPE)
- Custom time pickers.
- Regeneration feature (to be rebuilt in future phases).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| ONB-01 | Progressive Disclosure UI | Use `showScreen` in `ui.js` with fade-in/out transitions. |
| ONB-02 | Local Storage Persistence | Extend `store.js` with `onboarding_draft` key. |
| ONB-03 | Material-Based Tasks | Modify `scheduler.py` to prioritize "Simulation" and "Review" anchors. |
| ONB-04 | Transition Steps | `LoadingAnimator` in `ui.js` supports step-based status updates. |
| ONB-05 | Legacy Cleanup | Remove `initRegenerate` from `app.js` and `brain.js` logic. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tailwind CSS | 3.x | Styling | Utility-first, perfect for minimalist "one screen" layouts. |
| Vanilla JS (ES6) | N/A | Logic | Existing codebase is modular ES6; no need for a framework overhead for this flow. |
| FastAPI | 0.x | Backend | Current high-performance API layer. |

## Architecture Patterns

### Recommended Onboarding State Structure
```javascript
// store.js
const ONBOARDING_DRAFT_KEY = 'sf_onboarding_draft';

export const saveOnboardingDraft = (data) => {
    const current = JSON.parse(localStorage.getItem(ONBOARDING_DRAFT_KEY) || '{}');
    localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ ...current, ...data }));
};

export const clearOnboardingDraft = () => localStorage.removeItem(ONBOARDING_DRAFT_KEY);
```

### Pattern 1: Step-by-Step Navigation
**What:** Use data-attributes and a central controller to toggle visibility.
**When to use:** Multi-step onboarding loops.
**Example:**
```javascript
// ui.js
export function setOnboardingStep(stepNum) {
    document.querySelectorAll('.onb-step').forEach(el => el.style.display = 'none');
    const target = document.getElementById(`onb-step-${stepNum}`);
    if (target) {
        target.style.display = 'block';
        target.classList.add('fade-in');
    }
}
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag & Drop | Raw Drag Events | Dropzone concepts or native input | Existing `modal-step-2` has file upload logic; enhance it. |
| Animations | Complex JS Timelines | Tailwind `transition` + `opacity` | Performance and simplicity on mobile. |

## Common Pitfalls

### Pitfall 1: Local Storage Desync
**What goes wrong:** User completes onboarding on mobile, but desktop still shows the wizard.
**How to avoid:** Only use local storage for *unsubmitted* drafts. Once submitted, the backend `onboarding_completed` flag is the source of truth.

### Pitfall 2: Memory Leaks in Multi-Step
**What goes wrong:** Event listeners attached multiple times when users navigate back/forward.
**How to avoid:** Use delegated event listeners or ensure `initOnboarding` only runs once.

## Code Examples

### Backend Anchor Logic (FastAPI)
```python
# scheduler.py logic
if file_type == "past_exam":
    # Anchor to last 3 days
    task_duration = 180 # 3 hours
elif file_type == "syllabus":
    # Anchor to day 1
    task_duration = 90  # 1.5 hours
```

## Sources

### Primary (HIGH confidence)
- `frontend/js/ui.js` - `LoadingAnimator` class and `showScreen`.
- `backend/brain/scheduler.py` - Core scheduling logic.
- `index.html` - Existing modal and screen structures.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Aligned with existing project.
- Architecture: HIGH - Follows existing module pattern.
- Pitfalls: MEDIUM - Based on common PWA/Local Storage issues.

**Research date:** 2026-03-06
**Valid until:** 2026-04-05
