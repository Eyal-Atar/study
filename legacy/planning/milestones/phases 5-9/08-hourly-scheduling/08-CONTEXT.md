# Phase 8 Context: Hourly Time Slot Scheduling

## Overview
Phase 8 transforms the study schedule from a simple list of tasks into a precise, hourly-mapped calendar. This requires a transition to UTC-based storage, a more granular UI, and an AI scheduler capable of non-overlapping time allocation.

## Implementation Decisions

### Hourly Grid UI/UX
- **Grid Scope:** A full **24-hour vertical grid** will be displayed to provide a complete view of the day.
- **Block Density:** Task blocks will display essential information (Name, Time Range) and use subject-based coloring where available.
- **Current Time Indicator:** Not required for this phase.
- **Interactions:** Clicking an empty slot in the grid should open a task creation interface. This manual addition must be communicated back to the AI brain to ensure the rest of the schedule remains valid and non-overlapping.

### Hobby & Break Integration
- **Placement:** The **AI decides** the optimal placement for hobby blocks based on the study load and user preferences captured in Phase 7.
- **Frequency:** The AI determines whether to schedule a single large hobby block or multiple smaller breaks.
- **Visuals:** Hobby and break blocks must be **highlighted in a distinct color** (e.g., green or purple) to differentiate them from academic tasks.
- **Flexibility:** If tasks run over or schedule conflicts occur, the AI is responsible for deciding whether to truncate or shift blocks.

### Timezone & Persistence
- **Storage Strategy:** All time slots are stored in **UTC (ISO 8601)** in the database.
- **Display Strategy:** Times are converted to the **user's local timezone** on the frontend.
- **Transitions:** Standard library handling (e.g., `Intl.DateTimeFormat` or `dayjs`) will be used for DST and midnight-crossing tasks.

### Granularity & Gaps
- **Minimum Duration:** The smallest scheduling unit is **15 minutes**.
- **Snap-to-Grid:** The UI and API will support flexible snapping (15/30/60m) based on the specific task duration.
- **Gap Handling:** Unscheduled time gaps will remain **clear and unlabeled** in the UI to avoid clutter.
- **Overflow:** If a daily schedule exceeds the user's defined study cap, tasks will be **automatically rearranged** and pushed to the next available day by the AI.

## Technical Constraints
- Must use existing modular frontend architecture (`tasks.js`, `calendar.js`).
- Backend routes in `brain/routes.py` and `tasks/routes.py` must be updated to handle `start_time` and `end_time` fields.
- AI prompt in `brain/exam_brain.py` requires updating to support hourly slot allocation logic.

## Deferred Ideas
- *Manual drag-and-drop editing (Reserved for Phase 9)*
- *Productivity heatmaps for hobby placement optimization*
