# Phase 15: Task Checkbox Sync, Exam Progress Bars, and Push-to-Next-Day Foundation - Context

**Gathered:** 2026-02-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Dynamic progress system with gamification feel: task checkboxes sync instantly, progress bars update live across daily and exam views, and users can defer incomplete tasks to the next day. This phase builds the foundation for flexible schedule management.

</domain>

<decisions>
## Implementation Decisions

### Checkbox interaction
- Optimistic UI: checkmark appears instantly on tap in Today's Focus
- Background sync to server (no loading spinner blocking the user)
- State syncs between Today's Focus tab and Calendar/Roadmap via central store

### XP Progress Bars
- **Daily Bar:** shows progress for current day's tasks only
- **Exam Master Bar:** shows overall progress across all tasks in that exam's roadmap
- Color transitions: starts orange/yellow, shifts to green as progress increases, bright green at 100%
- On completing the final task: glow animation (short burst) on the bar
- Both bars use CSS transitions for smooth visual updates

### Push-to-Next-Day (Defer) logic
- When user defers a task:
  1. Original task gets status `deferred`, visually grayed out on its original day
  2. A new copy is created on the next calendar day automatically
  3. Linked via `linkedTaskId` for history tracking
- Deferred tasks are **excluded** from the original day's percentage denominator (no "punishment" for deferring)
- Deferred tasks are **added** to the next day's denominator
- Deferral allowed up to and including exam day itself
- Delete removes task entirely from all calculations (daily and exam-wide)

### Data schema changes
- `status` field: enum of `pending`, `completed`, `deferred`
- `originalDate`: preserves the task's original scheduled date for tracking
- `linkedTaskId`: links deferred copy back to the original task

### Progress formulas
- **Daily %** = completed / (total - deferred) * 100
- **Overall Exam %** = total completed / total tasks in roadmap * 100

### Claude's Discretion
- Exact CSS transition/glow animation implementation
- Where to place the daily bar vs exam bar in the UI layout
- How to handle the defer button/gesture (swipe, button, or long-press)
- Error handling for failed background syncs

</decisions>

<specifics>
## Specific Ideas

- "XP Bar" naming — gamification feel, not dry progress tracker
- Color feedback gradient: orange/yellow to bright green mirrors a "charging up" feeling
- Deferred tasks should look visually distinct (grayed/faded) but still visible on original day for transparency
- The system should feel fast and responsive — no waiting on server for visual feedback

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-task-checkbox-sync-exam-progress-bars-and-push-to-next-day-foundation*
*Context gathered: 2026-02-24*
