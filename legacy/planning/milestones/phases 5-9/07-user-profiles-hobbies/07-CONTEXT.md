# Context: Phase 7 - User Profiles & Hobbies

## Phase Goal
Capture and manage user hobby preferences and daily routine metadata to enable personalized study scheduling in subsequent phases.

## Implementation Decisions

### 1. Mandatory Onboarding Wizard
- **Timing:** Triggered immediately after the first successful Google Sign-In (Phase 6).
- **Structure:** A multi-step, mobile-friendly "Wizard" (not a single long form).
- **Completion State:** A "Profile Success" animation (quick feedback) followed by a redirect to the main dashboard.

### 2. Data Points & Input Experience (The "Profiler")
To create an "optimum schedule" in Phase 8, the following data must be captured during onboarding:

| Data Point | UI/Input Component | Notes |
| :--- | :--- | :--- |
| **Hobby Name** | Icons + Tags + "Other" | Common tags (Gym, Gaming, Reading) with icons. "Other" opens a free-text field. |
| **Sleep/Wake Cycle** | Time Pickers | Capture "Wake Up" and "Sleep" times to define the daily active window. |
| **Study Load** | Slider | Capture "Neto learning hours" per day (the actual hours dedicated to study). |
| **Peak Productivity** | General Preference | Selection between 'Morning', 'Afternoon', 'Evening', or 'Night'. |

### 3. Scheduling Integration (Phase 8+ Forward-Thinking)
- **AI-First Logic:** The timing and placement of hobbies in the calendar will *not* be fixed by the user during input. Instead, the AI scheduler will use the profile data (Wake/Sleep, Productivity Peak, and Neto Hours) to "optimize" the hobby's position.
- **Phase 7 Scope:** This phase is responsible for *capturing* and *persisting* this data. The actual scheduling logic happens in Phase 8.

### 4. Profile Management (Post-Onboarding)
- **Editability:** Users can update these preferences from a "Settings" or "Profile" section on the dashboard.
- **Persistence:** All profile data must be stored in the database and associated with the authenticated user ID.

## Deferred Ideas
- **Multiple Hobbies:** Initial implementation focuses on a single "main" hobby daily slot to keep the scheduler simple for v1.
- **Variable Study Load:** Capture a single "neto" value for now; weekend vs. weekday load is deferred to later optimization phases.
- **Fixed Hobby Slots:** Allowing users to "lock" a hobby to a specific time (e.g., '17:00 every day') is deferred; the AI will propose the initial slot.
