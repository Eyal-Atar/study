# Phase 24: Improving Onboarding — User Context

## 1. The Icebreaker (Pre-Step)
- Clean screen with one big question: "How many exams do you have this semester?"
- Big, clear buttons (1, 2, 3, 4, 5, 6+). Clicking advances immediately with smooth slide/fade animation.
- Psychology: Creates commitment + enables accurate progress bar ("Exam 1 of 4").

## 2. Learning Profile (Step 0 Refined)
- User sets learning preferences (morning/evening, net hours, rest days).
- Better microcopy in student-friendly language:
  - "When does your brain work best?" (time window selection)
  - "How many net hours is realistic for you to study per day?" (hours slider)
  - "How many full rest days do you want us to account for before each exam?" (buffer)
- Hours slider must show live numeric feedback that moves with the drag.

## 3. Unified Exam Card (Unified Exam Input)
- Core change: Merge old steps 1 and 2 into one smart card to reduce cognitive load.
- Card structure:
  - **Top section (dry details):** Course name, exam date, difficulty level (1-5 with fire/lightning icons instead of plain numbers).
  - **Bottom section (Smart Dropzone):** File drag area built directly below details.
- Guidance text near dropzone: "Our tip: The system can analyze syllabi, but it loves past exams the most. This helps us map recurring questions for you."
- Visual feedback:
  - Dropzone border glows (accent color) when file is dragged over.
  - Successful upload gets a pop animation with green checkmark (#10B981).
  - Delete and tag change (Past Exam / Syllabus) must be immediately available.

## 4. Exam Loop Management
- Since we know exam count from Pre-Step, button logic changes:
  - Exam 1 of 4: Button says "Save and continue to next exam"
  - Exam 4 of 4: Button is more prominent, gradient colored, says "Done! Build my schedule" (Create My Study Plan)
- Escape option: Always show small text button "Enter remaining exams later" for users who want to see the system in action.

## 5. "The Brain is Thinking" Screen (Dynamic Loading Overlay)
- Dark overlay with scanning/thinking graphic (waves or document scanner). No generic spinners.
- JS Timer logic: Array of text strings cycling every 2.5-3 seconds via setInterval.
- Personalization: Inject course names from state into loading messages:
  - "Decoding the files you uploaded..."
  - "Reading the syllabus of [Course 1]..."
  - "Detecting knowledge gaps and tricky questions in [Course 2]..."
  - "Scheduling strategic reviews based on your study windows..."
  - "Assembling your final action plan..."
- Transforms frustrating wait time into a value-demonstrating magic show.

## 6. Technical Cleanup
- Complete removal of `onb-auto-fill` (test file code) from HTML and onboarding.js to prevent confusion in production.
- Clean up unnecessary global variables in file upload state management.
- Move to clear data structure: object per exam in array, including its files, until submission to server.
