# Phase 10: Regenerate Roadmap - Context

**Gathered:** 2026-02-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the brain chat interface with a focused global regeneration input that triggers full schedule regeneration only when core scheduling constraints change. Implements a token-efficient delta update strategy — the AI only receives a compressed snapshot of the affected window and only returns changed tasks, not a full schedule rebuild. Manual task edits and fixed events are always preserved.

</domain>

<decisions>
## Implementation Decisions

### Conditional Trigger (When Regeneration Becomes Available)
- Regeneration option/button is HIDDEN by default — not always visible
- Two events unlock/show the regeneration prompt:
  1. An exam date is updated or moved
  2. New study materials (files/syllabus) added to a subject, increasing required study hours
- Frontend state must track these changes and reveal the "Regenerate" command bar only when triggered
- Backend must also enforce this condition (no open-ended regeneration endpoint)

### Token-Efficient Data Compression (Backend Utility)
- Before calling the AI, a utility function fetches only tasks in the relevant time window (next 14 days)
- Tasks are mapped to a compressed pipe-separated string format (NOT full JSON)
- **Format:** `[TaskID]|[Type]|[Status]|[Day][StartTime]-[EndTime]`
  - `Type`: `FIX` (Exams/Classes — never move) or `FLX` (Study sessions/Hobbies — can move)
  - `Status`: `M` (Manually edited by user — MUST BE PRESERVED) or `A` (Auto-generated)
  - Example: `101|FLX|M|Sun09:00-11:00;102|FIX|A|Mon10:00-12:00`

### AI Prompt & Delta Response
- AI System Prompt instructs it to act as a schedule optimizer responding to a changed constraint
- **Hard rules embedded in prompt:**
  1. NEVER change tasks with Status `M` (Manual) or Type `FIX` (Fixed)
  2. Only output the Delta (tasks that actually moved — not unchanged tasks)
  3. Do NOT output full JSON
- **Response format:**
  ```
  Reasoning: [1 sentence explaining the shift]
  [TaskID]:[NewDay][NewStart]-[NewEnd]
  [TaskID]:[NewDay][NewStart]-[NewEnd]
  ```
- Short reasoning line always included before the delta lines

### Delta Reintegration (Backend)
- A parser function takes the AI's minimal text response
- Extracts changed TaskIDs and their new time slots
- Updates ONLY those specific tasks in the database (surgical update, not full replace)
- Tasks with `Status = M` or `Type = FIX` are skipped even if AI erroneously includes them (safety check)

### Claude's Discretion
- Exact UI component design for the regeneration command bar (appearance, placement)
- Loading/progress state during AI call
- What to show user after regeneration completes (confirmation, diff summary, or just updated calendar)
- Error handling for when AI response cannot be parsed or returns invalid task IDs

</decisions>

<specifics>
## Specific Ideas

- The regeneration flow is explicitly token-efficient — compressed string format over full JSON
- Manual edits (Status `M`) must survive regeneration — this is a hard constraint, not optional
- Fixed events (Type `FIX`) like exams and classes must never be moved by the AI
- Delta-only approach: AI returns only what changed, not the full schedule
- The trigger condition is constraint-based (exam moved OR study hours increased) — not user-initiated at will

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-regenerate-roadmap*
*Context gathered: 2026-02-22*
