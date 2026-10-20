# Phase 09: Interactive Task Management - Research

**Researched:** 2026-02-21
**Domain:** UX & Interaction (Calendar/Drag-and-Drop)
**Confidence:** HIGH

## Summary
The phase requires implementing an interactive, mobile-first calendar with "push physics" (cascading event shifts). The existing project uses `vkurko/calendar` (EventCalendar), which provides the foundation for drag/drop and resize but requires custom logic for the physics engine and swipe-to-delete functionality.

**Primary recommendation:** Use `vkurko/calendar`'s callback system (`eventDrop`, `eventResize`) to trigger a recursive collision resolution algorithm that shifts subsequent events down the timeline.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vkurko/calendar` | Latest | Calendar UI & Drag/Drop | Already integrated; lightweight, zero-dependency, FullCalendar-compatible API. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|--------------|
| Native DOM/JS | ES6 | Swipe-to-delete | Use `touchstart`/`touchmove` on event elements for iOS-style swipe. |

## Architecture Patterns

### Push-Physics Algorithm (Collision Resolution)
1. **Trigger:** `eventDrop` or `eventResize` callback.
2. **Identification:** Get all events from the calendar store.
3. **Sorting:** Sort all events by `start` time.
4. **Shift Logic:** 
   - Start from the modified event.
   - For each subsequent event: if `current.start < previous.end`, set `current.start = previous.end` and preserve duration.
   - Continue until no more overlaps or end of day (Midnight Overflow).
5. **Update:** Use `calendar.setOption('events', updatedEvents)` or update the reactive store.

### Mobile Interaction Pattern
- **Long-Press Activation:** Set `eventLongPressDelay: 200` to allow scrolling without accidentally dragging.
- **Visual Feedback:** Use the `eventDragStart` callback to apply a CSS class (e.g., `.is-lifting`) that adds `transform: scale(1.02)` and a shadow.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar Grid | Custom Grid | `vkurko/calendar` | Handles complex time-slot rendering and cross-browser drag/drop. |
| Timezone Logic | Manual Offset | `Intl.DateTimeFormat` | Built-in browser support handles DST and local variations accurately. |
| Basic Drag/Resize | Custom Pointer Listeners | Calendar `editable: true` | Library handles snapping and coordinate-to-time mapping. |

## Common Pitfalls

- **Infinite Loops:** Ensure the push algorithm doesn't re-trigger `eventDrop` if it updates the same event. Use a "silent" update or a flag.
- **Midnight Overflow:** If a task is pushed past 23:59, the algorithm must handle the "Delayed" status rather than squashing it to zero duration.
- **Touch Conflict:** Native browser "pull-to-refresh" can interfere with dragging. Use `touch-action: none` on draggable elements.

## Code Examples

### Push Physics (Simplified)
```javascript
function resolveCollisions(events, movedEventId) {
    const sorted = [...events].sort((a, b) => new Date(a.start) - new Date(b.start));
    let changed = false;

    for (let i = 0; i < sorted.length - 1; i++) {
        let current = sorted[i];
        let next = sorted[i+1];
        
        if (new Date(next.start) < new Date(current.end)) {
            const duration = new Date(next.end) - new Date(next.start);
            next.start = current.end;
            next.end = new Date(new Date(next.start).getTime() + duration).toISOString();
            changed = true;
        }
    }
    return sorted;
}
```

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Push Mode: Events slide down automatically.
- iOS Native Feel: Long-press (200ms) to lift.
- Deletion: Swipe-left reveals red delete button.
- AI Sync: Manual blocks are "preferred" and AI moves them only for strict deadlines.

### Claude's Discretion
- Implementation of the collision algorithm.
- CSS styling for the "lift" and "shadow" effects.
- Playful message content for hobby deletion.

### Deferred Ideas (OUT OF SCOPE)
- Real-time chat.
- Mobile native app (using PWA instead).
