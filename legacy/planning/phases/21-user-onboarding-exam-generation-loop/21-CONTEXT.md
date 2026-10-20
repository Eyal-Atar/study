# Phase 21: User Onboarding & Exam Generation Loop - Context

## User Experience (UX) & Minimalist Design

*   **Progressive Disclosure:** A design principle of "one screen, one focus". Breaking down the onboarding process into clean, simple steps to prevent cognitive overload, utilizing a clean visual language (generous whitespace, minimal borders).
*   **Profiling Questionnaire:** A friendly, preliminary question screen to collect personal learning preferences.
    *   **Decision (Constraint Granularity):** Use **Preset choices (Chips/Buttons)** only. No custom time pickers to minimize friction.
    *   **Study Hours:** "Morning (08:00-14:00)", "Afternoon (14:00-20:00)", "Night (20:00-02:00)". Users can multi-select.
    *   **Buffer Days:** Toggle chips for "0", "1", or "2" full days off before the exam.
*   **Onboarding Persistence:**
    *   **Decision (Dropout Recovery):** Use **Local Storage**. The app will hydrate state from Local Storage if the tab is closed or refreshed.
    *   **Logic:** Data is only sent to the FastAPI backend/DB upon clicking the final "Create my study plan" button, at which point Local Storage is cleared.
*   **The Exam Input Loop:** A focused interface for course name, date, and difficulty.
    *   Secondary button (Outline): **"Add another exam"** – stays in the loop.
    *   Primary button (Prominent): **"I'm done, create my study plan"** – triggers generation.

## Study Materials Management & Validation

*   **Mandatory Material Upload (1-3 files):** Strict validation in React. Action buttons remain `Disabled` until at least one file/image is uploaded (max 3 per exam).
*   **Prioritizing Past Exams & Auto-tagging:** Dropzone microcopy guides users to upload past exams.
    *   Uploaded files default to **"Past Exam"** tag, with options for **"Syllabus"** or **"Formula Sheet"**.
*   **Native PWA Capabilities:** Support for opening the camera directly for snapshots and Drag & Drop for PDFs.
*   **Immediate Feedback:** Thumbnails/icons displayed immediately after upload with a delete button for reassurance.

## Algorithmic Translation (FastAPI) & The "Aha" Moment

*   **Material-Based Task Logic:**
    *   **Decision (Fixed Weights):** Fixed academic weights anchored to specific timeline phases.
    *   **Past Exams ("Simulation"):** Fixed 3-hour duration. Strictly anchored to the final days leading up to the exam (e.g., 3 exams = last 3 days).
        *   **Dynamic Naming:** If files are tagged as "Past Exam", the system links them to simulation blocks and renames the task to **"Simulation: [Exam Filename]"**.
        *   **Nudge Mechanism:** If no "Past Exam" files are uploaded (only syllabus/summary), generic **"Full Simulation"** tasks are still created to nudge the student to find and solve a practice test.
    *   **Syllabus/Summary ("Review"):** Fixed 1.5-hour duration. Anchored to the very first day of the course's learning block.
*   **Algorithmic Weighting:** Difficulty level scales the total study hours allocated.
*   **Smart Transition Screen:**
    *   **Decision (Real-time Progress):** Display **Real-time AI progress steps** rather than a generic spinner.
    *   **Example Steps:** "Extracting syllabus constraints..." -> "Mapping past exams to timeline..." -> "Calculating optimal time blocks..." -> "Finalizing your roadmap."

## Post-Onboarding Interface & Context Protection

*   **Organized Default View:** Calendar and dashboard present a holistic experience immediately. No "empty calendar" states.
*   **Hiding Onboarding Actions:** Once the schedule is created, the "Create study plan" button disappears to prevent confusion.
*   **Removal of Legacy Regeneration:** The existing "Regenerate" mechanism is **completely removed** to prevent accidental context overwriting. This feature will be rebuilt in future phases using the new infrastructure.
