# Phase 14: Mobile-First UX and Appification - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Transform the existing desktop-first StudyFlow app into a native-feeling mobile experience. Covers: bottom tab navigation, touch-action fixes, bottom-sheet modals, long-press drag with haptic feedback, scroll-lock during drag, edge scrolling, and mobile-friendly touch targets. Desktop layout is untouched.

</domain>

<decisions>
## Implementation Decisions

### Bottom Navigation (replaces hamburger drawer)
- Fixed **Bottom Tab Bar** (iOS/Android style) on screens < 768px
- 3 tabs: **Roadmap** (calendar full-width), **Focus** (Today's Focus list), **Exams** (My Exams + Settings gear)
- No hamburger/drawer — bottom bar IS the mobile navigation
- Desktop layout (>= 768px) unchanged — no bottom bar shown

### Tap vs Long-Press Drag Disambiguation
- **Quick tap (< 300ms):** Opens task edit modal (bottom sheet)
- **Long press (>= 300ms):** Activates drag mode
- On drag activation: `navigator.vibrate(50)` (if supported) + `.dragging` CSS class applied to block
- `.dragging` class: `transform: scale(1.05)` + prominent `box-shadow`

### Scroll-Lock & Edge Scrolling During Drag
- When drag is active: lock page scroll (`overflow: hidden` on body / `touch-action: none` on calendar container)
- Edge scrolling: auto-scroll calendar when dragged element reaches top 10% or bottom 10% of viewport
- Scroll lock released on touchend

### Calendar Density & Touch Targets
- Keep current hour layout/scale (no change to HOUR_HEIGHT or grid)
- Checkbox minimum touch target: **44×44px** (achieved via padding or `::after` pseudo-element)
- Long task titles truncated with `line-clamp` CSS in small blocks
- Claude's discretion: exact edge-scroll speed/acceleration, line-clamp threshold by block height

### Modal Behavior (already implemented)
- Add Exam, Settings, Edit Task modals: bottom sheets on mobile (already done — `modal-sheet` class)
- Confirmation modal stays centered on all screen sizes

### Claude's Discretion
- Exact edge-scroll implementation (requestAnimationFrame vs setInterval)
- Mouse vs touch drag handling split (keep interact.js for mouse, custom touch handlers for touch)
- Bottom tab bar icon choice
- Mobile app bar content (title updates per tab vs static logo)

</decisions>

<specifics>
## Specific Ideas

- "iOS/Android style" bottom tab bar — native app feel
- The Exams tab includes a Settings gear icon button
- `navigator.vibrate(50)` on drag activation — haptic feedback
- 44×44px touch target rule (Apple HIG standard) for checkboxes
- `line-clamp` for task titles in small blocks

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 14-mobile-first-ux-and-appification*
*Context gathered: 2026-02-23*
