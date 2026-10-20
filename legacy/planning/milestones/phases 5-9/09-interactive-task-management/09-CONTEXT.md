# Phase 9 Context: Interactive Task Management

## Domain: UX & Interaction
Apple-style interactive study grid with mobile-first gestures and real-time physics.

## Conflict Handling (Live-Push Physics)
- **Push Mode:** If Task A is dragged or resized onto Task B, Task B (and all subsequent blocks) must slide down automatically to make room.
- **Live Preview:** The push effect must be visible during the drag/resize action (smooth interpolation), not just upon drop.
- **Overflow Strategy:** If the "push" chain hits the end of the day (midnight), the last task should be marked as "Delayed" rather than being squashed.
- **Block Types:** Every block (Study, Break, Hobby) is reactive. Manual moves push everything else without distinction.

## Mobile Gestures (iOS Native Feel)
- **Trigger:** Use "Long-Press to Lift" (approx. 200ms) to initiate a drag on mobile to differentiate from scrolling.
- **Visual Feedback:** Upon "lift," the block should scale up slightly (1.02x) and drop a prominent shadow.
- **Deletion:** Swipe-left on a block reveals a red delete button (iOS style).
- **Resizing:** Handle is invisible (bottom-edge only). Resizing snaps to 15-minute increments.

## AI Sync & Persistence
- **Balanced AI Approach:** The AI Brain must respect manual blocks as "preferred locations." It can only move them if a strict exam deadline is at risk.
- **Scope of Edit:** Renaming a block or changing its time applies ONLY to that specific block instance, not the global task definition.
- **UI Visibility:** The "Talk to the Brain" chat interface is context-aware; it appears only when the user is in "Edit Mode" or interacting with tasks.

## Creation & Deletion Flow
- **Task Creation:** A floating "Plus" button is used to spawn new tasks.
- **Renaming:** Clicking a block "opens" it (modal or expanded view) where the title and details can be edited.
- **Hobby Deletion:** Hobby blocks are deletable. To encourage study-life balance, show a funny/playful confirmation message before removal (e.g., "Are you sure? Your brain cells might miss this break!").
- **Current Time Indicator:** A horizontal red line must track the current local time across the grid (safe mode: only if it doesn't interfere with drag performance).

## Success Criteria
- [ ] Dragging one task pushes all others down in real-time.
- [ ] Long-press activation works on mobile without breaking scroll.
- [ ] Deleted hobbies trigger a playful message.
- [ ] Manual edits are saved per-block instance.
