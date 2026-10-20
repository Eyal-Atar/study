---
status: partial
phase: 24-22-improving-onboarding
source: [24-VERIFICATION.md]
started: 2026-04-12T16:40:00Z
updated: 2026-04-12T16:40:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end onboarding flow verification
expected: Full onboarding flow works correctly with all 6 locked decisions from CONTEXT.md implemented
result: [pending]

Steps:
1. Clear localStorage and open the app in a fresh browser session
2. **Icebreaker:** Confirm "How many exams do you have this semester?" with 6 big buttons (1-6+). Click "3" — should advance smoothly.
3. **Learning Profile:** Confirm student-friendly labels ("When does your brain work best?", "How many net hours...", "How many full rest days..."). Drag the hours slider — live number should update.
4. **Unified Exam Card:** Confirm exam details (name, date, difficulty with fire/lightning icons) AND file dropzone appear on the SAME screen. Guidance text: "Our tip: The system can analyze syllabi, but it loves past exams the most."
5. **Dropzone Feedback:** Drag a file over the dropzone — border should glow. Drop it — file appears with pop animation and green checkmark.
6. **Exam Loop:** Fill exam 1, click "Save and continue to next exam". Counter shows "Exam 2 of 3". On exam 3, button says "Done! Build my schedule" with gradient styling.
7. **Escape Hatch:** Fresh flow, fill only exam 1, click "Enter remaining exams later" — submits with just that exam.
8. **Loading Overlay:** Personalized messages cycling every ~3 seconds, including actual course names.
9. **Cleanup:** No "Auto Fill" test button anywhere. Check browser console for errors.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
