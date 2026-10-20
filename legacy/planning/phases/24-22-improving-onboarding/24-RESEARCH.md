# Phase 24: Improving Onboarding — Research

**Researched:** 2026-03-21
**Domain:** Vanilla JS UX Wizard, Progressive Disclosure, Frontend State Management
**Confidence:** HIGH

## Summary

Phase 24 is a pure frontend improvement pass on the onboarding wizard already built in Phase 21. The existing wizard lives in `onboarding.js` (545 lines), `index.html` (onboarding section ~lines 217–337), and `frontend/css/styles.css`. No backend work is required — the API endpoint `POST /brain/onboard` and its payload shape are unchanged.

The changes add a new "Icebreaker" pre-step (step -1 / step 0 before current step 0), restructure step 1+2 into a unified exam card with an embedded dropzone, improve the loading overlay to be personalized and cinematic, and remove the `onb-auto-fill` test button and any stale global variables.

The project uses vanilla JS ES6 modules, Tailwind CSS utility classes, and has an existing `LoadingAnimator` class in `ui.js` and CSS primitives (`.fade-in`, `.progress-bar`, `.status-fade`) ready to reuse. No new libraries are needed.

**Primary recommendation:** Implement entirely in `onboarding.js` + `index.html` HTML template; reuse existing CSS animation primitives. Add the Icebreaker as a new step-index-0 and renumber existing steps. The loading overlay upgrade targets the existing `#loading-overlay` element.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**1. Icebreaker Pre-Step**
- One big question: "How many exams do you have this semester?"
- Big clear buttons: 1, 2, 3, 4, 5, 6+. Click advances immediately with smooth slide/fade.
- Stores exam count for accurate progress bar ("Exam 1 of 4").

**2. Learning Profile (Step 0 Refined — existing step 0)**
- Student-friendly microcopy:
  - "When does your brain work best?" (time window)
  - "How many net hours is realistic for you to study per day?" (slider)
  - "How many full rest days do you want us to account for before each exam?" (buffer)
- Hours slider MUST show live numeric feedback that moves with the drag.

**3. Unified Exam Card (merges old step 1 + step 2)**
- Top section: course name, exam date, difficulty 1-5 with fire/lightning icons (not plain numbers).
- Bottom section: file dropzone embedded directly below the details.
- Dropzone guidance: "Our tip: The system can analyze syllabi, but it loves past exams the most. This helps us map recurring questions for you."
- Visual feedback: border glows accent color on dragover; successful upload gets pop animation + green checkmark (#10B981); delete and tag-change immediately available.

**4. Exam Loop Management**
- Button logic adapts to known exam count from Icebreaker:
  - Exam N of M (not last): "Save and continue to next exam"
  - Exam M of M (last): prominent gradient button "Done! Build my schedule"
- Escape hatch: small text button "Enter remaining exams later" always visible.

**5. "The Brain is Thinking" Loading Overlay (Dynamic)**
- Dark overlay with scanning/thinking graphic (waves or document scanner). No generic spinner.
- JS timer: array of strings cycling every 2.5–3 seconds via `setInterval`.
- Personalized messages using course names from in-memory state:
  - "Decoding the files you uploaded..."
  - "Reading the syllabus of [Course 1]..."
  - "Detecting knowledge gaps and tricky questions in [Course 2]..."
  - "Scheduling strategic reviews based on your study windows..."
  - "Assembling your final action plan..."

**6. Technical Cleanup**
- Complete removal of `#onb-auto-fill` button from HTML and its handler from `onboarding.js`.
- Clean up `window._onb_current_exam` global — move to module-level variable or inline into draft state.
- Clear data structure: one object per exam in array, each containing its files, until final submission.

### Claude's Discretion
- Exact animation style for the Icebreaker slide/fade transition.
- Whether fire/lightning icons are emoji or inline SVG.
- Wave vs. document-scanner visual for the loading overlay graphic.
- Whether the "Enter remaining exams later" skip button saves partial exams or skips only unfilled ones.

### Deferred Ideas (OUT OF SCOPE)
- Any backend changes.
- Changing the API payload structure.
- Drag-and-drop reordering of entered exams.
- Multi-language copy.
</user_constraints>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vanilla JS ES6 modules | N/A | All onboarding logic | Existing codebase pattern; no framework needed |
| Tailwind CSS | 3.x (CDN) | Utility styling | Already wired; classes like `bg-accent-500/20`, `rounded-2xl` are live |
| Native HTML Drag & Drop API | N/A | File dropzone | Already implemented in `onboarding.js` `ondragover`/`ondrop` handlers |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| CSS `@keyframes` (existing) | N/A | Slide/fade/pop micro-animations | Extend `fadeIn` and add new `popIn` keyframe for checkmark |
| `setInterval` / `clearInterval` | N/A | Cycling loading messages | Already used in `LoadingAnimator`; pattern is proven |

### No New Libraries Required
This phase is pure HTML/CSS/JS. Do not introduce any animation library (GSAP, Framer, etc.) — the project uses Tailwind transitions and hand-rolled `@keyframes` only.

---

## Architecture Patterns

### Existing Onboarding State Machine (HIGH confidence)

Located in `/Users/eyalatar/Desktop/try /studyflow/frontend/js/onboarding.js`.

Current step model:
- Step 0: Profiling (study windows, hours slider, buffer days)
- Step 1: Exam input (name, date, difficulty)
- Step 2: Material upload (file dropzone)

After Phase 24 the step model becomes:
- **Step -1 / "icebreaker"**: How many exams? (new — renders before the wizard counter)
- Step 0: Profiling (renamed copy, same data)
- Step 1 (unified): Exam card = name + date + difficulty + dropzone in one view
- (Step 2 is eliminated as a separate step)

**Implementation approach:** Add a new `#onb-step-icebreaker` element above `#onb-step-0` in HTML. The `setStep()` function handles numeric steps; for the icebreaker, add a separate `showIcebreaker()` / `hideIcebreaker()` helper or use `setStep('icebreaker')` with a string guard. Store exam count in draft as `draft.examCount`.

### In-Memory File State (HIGH confidence)

Current pattern in `onboarding.js`:
```javascript
// Map: exam index -> [{ file, tag }]
// -1 = current unsaved exam
const examFilesMap = new Map();
```

After merging steps 1+2, files are collected on the same screen as exam details. The `-1` key pattern stays valid — files are moved to the actual exam index when the user advances to the next exam.

`window._onb_current_exam` global MUST be replaced with a module-level `let _currentExamDraft = null` variable (or inline into `saveDraft` logic directly). This is a cleanup requirement from the CONTEXT.

### Progress Bar Counter

Because exam count is known after the Icebreaker, the header can show "Exam 2 of 4" instead of the generic "Step X/3". Update the counter logic in `setStep()` to use `draft.examCount` and `draft.exams.length + 1` (current exam index + 1).

### Dynamic Loading Overlay

The existing `#loading-overlay` element in `index.html` (lines 934–952) uses `LoadingAnimator` class from `ui.js`. For Phase 24, the loading overlay must:
1. Receive the list of course names from `onboarding.js` at submission time.
2. Build a personalized message array dynamically.
3. Cycle messages every 2500–3000ms using `setInterval`.

The `LoadingAnimator` class already supports `update(percent, text)` and uses `setInterval`. Extend it to accept a custom steps array, or build a separate `PersonalizedLoadingAnimator` inline in `onboarding.js` that directly manipulates `#loading-overlay` DOM elements.

**Simpler approach (recommended):** In `submitOnboarding()`, before calling `showModal('loading-overlay', true)`, set up a module-level interval that cycles through personalized messages into `#loading-status-text` and `#loading-text`. Clear the interval in `.stop()`.

### Difficulty Icons (fire/lightning instead of plain numbers)

Current HTML (index.html line 276-280):
```html
<button ... data-value="1">1</button>
...
<button ... data-value="5">5</button>
```

Replace button labels with emoji or SVG icons. Recommended pattern (emoji — no SVG dep):
- 1: `⚡` (easy)
- 2: `⚡⚡`
- 3: `🔥`
- 4: `🔥🔥`
- 5: `🔥🔥🔥`

Or alternatively: fire icons scale up visually. The `data-value` attribute stays unchanged so no JS logic changes.

### Dropzone Glow on Dragover

Existing code already adds `border-accent-500` and `bg-accent-500/10` on dragover. The CONTEXT requires the border to "glow" — add a `shadow-accent-500/40` box shadow class or a CSS rule:
```css
.onb-upload-area.dragover {
    box-shadow: 0 0 20px rgba(107, 71, 245, 0.3);
}
```
Toggle a `.dragover` class instead of individual Tailwind classes for cleanliness.

### File Upload Success Animation (pop + green checkmark)

After a file is added, `renderFileList()` re-renders the list. To add a "pop" animation on the newly added row, apply a CSS keyframe:
```css
@keyframes popIn {
    0%   { opacity: 0; transform: scale(0.85); }
    70%  { transform: scale(1.05); }
    100% { opacity: 1; transform: scale(1); }
}
.file-row-enter { animation: popIn 0.3s ease-out forwards; }
```
Apply `.file-row-enter` to each newly created `div.file-row` in `renderFileList()`.

### Anti-Patterns to Avoid

- **Using `addEventListener` in re-runnable setup functions:** The codebase correctly uses `onclick =` assignment instead of `addEventListener` in chip setup to prevent double-binding. Maintain this pattern in new code.
- **Storing File objects in localStorage:** Files stay in `examFilesMap` (memory only). The draft in localStorage stores only metadata `{ name, type }`. Do not change this.
- **Calling `initOnboarding()` more than once:** The function wires all event handlers. If it can be called multiple times (e.g., on screen show), ensure idempotency via guard flags or `onclick =` assignment.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS slide transitions | JS-based element moving | Tailwind `transition` + `opacity`/`transform` classes | Already proven in `.fade-in` |
| File drag tracking | Custom drag state manager | Existing `ondragover`/`ondrop` pattern in `onboarding.js` | Works, just needs glow class added |
| Cycling text animation | Typing effect library | `setInterval` + `status-fade` CSS class | Already used in `LoadingAnimator` |
| Pop/bounce on file add | JS animation library | `@keyframes popIn` CSS + class toggle | Simpler, no dep |

---

## Common Pitfalls

### Pitfall 1: Step Renumbering Breaks `setStep()` Logic
**What goes wrong:** Adding the Icebreaker as "step 0" and renumbering existing steps to 1, 2, 3 breaks the counter display ("Step 1/3" → needs to be "Step 1/3" still, skipping icebreaker in count) and all `setStep(0)`, `setStep(1)`, `setStep(2)` call sites.
**How to avoid:** Keep existing step numbers unchanged (0, 1, 2). Implement the Icebreaker as a separate pre-step outside the `onb-step-*` system, using a dedicated `showIcebreaker()` function. The `initOnboarding()` call starts with the icebreaker if `draft.examCount` is not yet set.
**Warning signs:** If you grep `setStep(0)` and find it called from multiple locations, changing the numbering will require touching all of them.

### Pitfall 2: Unified Card Removes `#onb-back-2` Navigation
**What goes wrong:** Merging step 1 and step 2 means the "Back" button from the old step 2 (which goes back to step 1) no longer makes sense. Users need to navigate back to Step 0 (profiling) or forward to the next exam.
**How to avoid:** In the unified card (new step 1), the "Back" button goes to Step 0 (profiling). Navigation between exams is handled by the "Save and continue" / "Done! Build my schedule" / "Enter remaining exams later" buttons only.

### Pitfall 3: Personalized Loading Messages Race Condition
**What goes wrong:** The loading overlay is shown immediately on submit; if course names are injected from `draft.exams` but the submit function clears the draft (`clearDraft()`) before the interval completes, the names become undefined.
**How to avoid:** Capture course names into a local variable BEFORE calling `clearDraft()`:
```javascript
const courseNames = draft.exams.map(e => e.name); // capture first
await submitToBackend(); // then submit
clearDraft(); // clear after success only
```
The interval references `courseNames` (closure), not `draft`.

### Pitfall 4: `onb-auto-fill` Removal Leaves Orphaned References
**What goes wrong:** The `autoFillBtn` variable in `setupMaterialUpload()` checks `if (autoFillBtn)` before using it. If the HTML button is removed but the JS code still runs `document.getElementById('onb-auto-fill')`, it simply returns null and the block is skipped — no crash. However the entire `autoFillBtn` code block (~30 lines) must be deleted to keep code clean.
**How to avoid:** Delete both the HTML `<button id="onb-auto-fill">` element AND the `autoFillBtn` block in `setupMaterialUpload()`. Grep for `onb-auto-fill` to confirm all references are gone.

### Pitfall 5: `window._onb_current_exam` Global Pollution
**What goes wrong:** Using `window._onb_current_exam` for cross-function communication is brittle — it can be overwritten by any other script.
**How to avoid:** Replace with a module-level variable declared at the top of `onboarding.js`:
```javascript
let _currentExamDraft = null; // replaces window._onb_current_exam
```
Update all three references: the assignment in `setupExamInput()`, the read in `updateMaterialScreen()`, and the read+clear in `saveCurrentExam()`.

---

## Code Examples

### Icebreaker Step HTML Pattern
```html
<!-- ICEBREAKER (pre-step, outside .onb-step numbering) -->
<div id="onb-icebreaker" class="onb-step">
    <h2 class="text-2xl font-bold mb-2 text-center">How many exams do you have this semester?</h2>
    <p class="text-white/40 text-center mb-8">This helps us build an accurate progress tracker for you.</p>
    <div class="grid grid-cols-3 gap-3">
        <button class="onb-exam-count-btn py-4 text-2xl font-bold rounded-2xl bg-dark-900/50 border border-white/10 transition-all hover:border-accent-500/50" data-value="1">1</button>
        <!-- ... 2, 3, 4, 5, 6+ -->
    </div>
</div>
```

### Icebreaker JS Handler
```javascript
function setupIcebreaker() {
    const btns = document.querySelectorAll('.onb-exam-count-btn');
    btns.forEach(btn => {
        btn.onclick = () => {
            const count = btn.dataset.value === '6+' ? 6 : parseInt(btn.dataset.value);
            saveDraft({ examCount: count });
            showIcebreaker(false);
            setStep(0); // go to profiling
        };
    });
}

function showIcebreaker(show = true) {
    const el = document.getElementById('onb-icebreaker');
    if (!el) return;
    el.style.display = show ? 'block' : 'none';
    if (show) { void el.offsetWidth; el.classList.add('fade-in'); }
    // Hide all numbered steps when showing icebreaker
    if (show) document.querySelectorAll('.onb-step').forEach(s => {
        if (s.id !== 'onb-icebreaker') s.style.display = 'none';
    });
}
```

### Personalized Loading Messages
```javascript
function buildLoadingMessages(courseNames) {
    const messages = [
        { p: 10, t: "Decoding the files you uploaded..." },
        ...courseNames.map((name, i) => ({
            p: 20 + (i * 15),
            t: `Reading the syllabus of ${name}...`
        })),
        { p: 70, t: `Detecting knowledge gaps and tricky questions in ${courseNames[courseNames.length - 1] || 'your exams'}...` },
        { p: 85, t: "Scheduling strategic reviews based on your study windows..." },
        { p: 95, t: "Assembling your final action plan..." },
    ];
    return messages;
}
```

### Exam Count Progress Label
```javascript
// In setStep() or a dedicated updateProgressLabel() helper:
function updateProgressLabel(examIndex) {
    const draft = loadDraft();
    const total = draft.examCount || '?';
    const current = examIndex + 1; // 1-based
    const counterEl = document.getElementById('onb-step-num');
    if (counterEl) counterEl.textContent = `Exam ${current} of ${total}`;
}
```

### File Row Pop Animation (CSS addition to styles.css)
```css
@keyframes popIn {
    0%   { opacity: 0; transform: scale(0.85); }
    70%  { transform: scale(1.05); }
    100% { opacity: 1; transform: scale(1); }
}
.file-row-enter { animation: popIn 0.3s ease-out forwards; }
```

---

## File Impact Map

| File | Change Type | What Changes |
|------|-------------|--------------|
| `index.html` | Modify | Add `#onb-icebreaker` block; update step 1 HTML to unified card (add dropzone below exam fields); remove `#onb-auto-fill` button; update step 2 navigation buttons |
| `frontend/js/onboarding.js` | Modify | Add `setupIcebreaker()`, `showIcebreaker()`; add `setupUnifiedExamCard()` merging old step 1+2; remove `setupMaterialUpload()` as standalone; remove `autoFillBtn` block; replace `window._onb_current_exam` with `let _currentExamDraft`; update `submitOnboarding()` with personalized loading; update button logic for known exam count |
| `frontend/js/ui.js` | Possibly modify | Optionally extend `LoadingAnimator` to accept custom steps; or handle fully in `onboarding.js` |
| `frontend/css/styles.css` | Modify | Add `@keyframes popIn` + `.file-row-enter`; add `.onb-upload-area.dragover` box-shadow glow rule |

No backend files touched. No new dependencies.

---

## State of the Art

| Old Approach (Phase 21) | New Approach (Phase 24) | Impact |
|-------------------------|-------------------------|--------|
| 3 separate steps (profile → exam → upload) | Icebreaker + profile + unified exam card | Fewer screens, less cognitive load |
| Generic "Step X/3" counter | "Exam X of N" with known total | Creates commitment + accurate progress |
| Plain number buttons (1-5) for difficulty | Fire/lightning emoji icons | More expressive, more memorable |
| Generic spinner ("Consulting the study brain...") | Personalized cycling messages with course names | Transforms wait into value demonstration |
| `window._onb_current_exam` global | Module-level `_currentExamDraft` | Eliminates global pollution |
| `onb-auto-fill` test button visible in production | Removed entirely | Cleaner production UX |

---

## Open Questions

1. **Icebreaker "6+" case**
   - What we know: User clicks "6+" button; we store a count.
   - What's unclear: Should we store `6` as a sentinel, or a high number like `99` to not cap the loop? The escape hatch "Enter remaining exams later" covers users with many exams who don't want to fill all now.
   - Recommendation: Store `6` as max; the escape hatch button handles the "I have more but want to skip" case.

2. **Escape hatch behavior**
   - What we know: "Enter remaining exams later" should let users see the system without filling all exams.
   - What's unclear: Does clicking it save the current exam (if filled) and submit, or discard the current unsaved exam?
   - Recommendation: Save the current exam if it has at least a name+date; then submit what's collected. Match behavior of current "Create My Study Plan" flow.

3. **Loading overlay: reuse vs. replace**
   - What we know: Existing `#loading-overlay` is used by onboarding submission today via `showModal('loading-overlay', true)`.
   - What's unclear: The CONTEXT says "Dark overlay with scanning/thinking graphic (waves or document scanner)." The current overlay only has a bouncing brain emoji.
   - Recommendation: Enhance the existing `#loading-overlay` with a wave/scanner graphic rather than creating a new element. Keep the existing element ID to avoid breaking `showModal` calls.

---

## Sources

### Primary (HIGH confidence)
- `/Users/eyalatar/Desktop/try /studyflow/frontend/js/onboarding.js` — Full current implementation (545 lines), all function signatures and state shape
- `/Users/eyalatar/Desktop/try /studyflow/index.html` lines 217–337 — Current onboarding HTML; lines 934–952 for loading overlay
- `/Users/eyalatar/Desktop/try /studyflow/frontend/css/styles.css` lines 280–330 — Existing animation primitives
- `/Users/eyalatar/Desktop/try /studyflow/frontend/js/ui.js` lines 92–149 — `LoadingAnimator` class, `showScreen`, `showModal`
- `.planning/phases/24-22-improving-onboarding/CONTEXT.md` — User decisions (all locked)

### Secondary (MEDIUM confidence)
- `.planning/phases/21-user-onboarding-exam-generation-loop/21-RESEARCH.md` — Architecture decisions from Phase 21 that this phase builds on

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Codebase fully inspected; all files read
- Architecture: HIGH — Changes are additive to an existing, working system; patterns are proven
- Pitfalls: HIGH — Derived from direct code inspection (global variable usage, step numbering, clearDraft timing)
- Loading overlay design: MEDIUM — Wave/scanner visual is Claude's discretion; existing DOM structure confirms feasibility

**Research date:** 2026-03-21
**Valid until:** 2026-04-20 (stable vanilla JS codebase)
