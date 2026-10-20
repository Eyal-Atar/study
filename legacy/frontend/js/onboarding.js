/* frontend/js/onboarding.js */
import { getAPI, authFetch, setCurrentUser, setCurrentExams, setCurrentSchedule } from './store.js?v=AUTO';
import { showScreen, LoadingAnimator } from './ui.js?v=AUTO';
import { renderAuditorReview } from './tasks.js?v=AUTO';

const ONBOARDING_DRAFT_KEY = 'sf_onboarding_draft';

// Default state for a fresh onboarding
const defaultDraft = {
    step: 0,
    profiling: {
        studyHours: [], // 'Morning', 'Afternoon', 'Night'
        bufferDays: 1,  // Default 1 day
        netoStudyHours: 4.0
    },
    exams: [] // Array of { name, date, difficulty, materials: [{ name, type }] }
};

// In-memory store for File objects (since localStorage can't hold them)
// Map of exam index -> array of { file, tag }
// For the current unsaved exam, we use index -1
const examFilesMap = new Map();

// _currentExamDraft removed — exam data is now collected inline in setupUnifiedExamCard()

/**
 * Saves onboarding progress to localStorage.
 */
export function saveDraft(data) {
    const current = loadDraft();
    const updated = { ...current, ...data };
    localStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify(updated));
    return updated;
}

/**
 * Loads onboarding progress from localStorage.
 */
export function loadDraft() {
    const saved = localStorage.getItem(ONBOARDING_DRAFT_KEY);
    return saved ? JSON.parse(saved) : { ...defaultDraft };
}

/**
 * Clears the onboarding draft (call after completion).
 */
export function clearDraft() {
    localStorage.removeItem(ONBOARDING_DRAFT_KEY);
    examFilesMap.clear();
}

/**
 * Sets up onclick handlers for the icebreaker exam count buttons.
 * Safe to call multiple times (idempotent via onclick assignment).
 */
function setupIcebreaker() {
    const btns = document.querySelectorAll('.onb-exam-count-btn');
    btns.forEach(btn => {
        btn.onclick = () => {
            const raw = btn.dataset.value;
            const count = raw === '6+' ? 6 : parseInt(raw, 10);
            saveDraft({ examCount: count });
            showIcebreaker(false);
            setStep(0);
        };
    });
}

/**
 * Shows or hides the icebreaker pre-step.
 * When showing, hides all .onb-step elements and applies fade-in animation.
 */
function showIcebreaker(show = true) {
    const el = document.getElementById('onb-icebreaker');
    if (!el) return;

    if (show) {
        // Hide all wizard steps
        document.querySelectorAll('.onb-step').forEach(s => s.style.display = 'none');
        el.style.display = 'block';
        // Force reflow for animation
        void el.offsetWidth;
        el.classList.add('fade-in');
    } else {
        el.style.display = 'none';
        el.classList.remove('fade-in');
    }
}

// Module-level exam loop state
let _currentExamIndex = 0;
// Module-level interval ID for loading messages
let _loadingInterval = null;

/**
 * Navigation: Sets the active step in the wizard.
 * Step 2 is now a hidden placeholder — the flow goes 0 → 1 → submit.
 */
export function setStep(stepNum) {
    // Skip step 2 entirely — it's been merged into step 1
    if (stepNum === 2) {
        // Guard: if somehow called with 2, treat as submission trigger
        return;
    }

    saveDraft({ step: stepNum });

    // Hide all steps
    document.querySelectorAll('.onb-step').forEach(el => {
        el.style.display = 'none';
        el.classList.remove('fade-in');
    });

    // Show target step
    const target = document.getElementById(`onb-step-${stepNum}`);
    if (target) {
        target.style.display = 'block';
        // Force a reflow for animation
        void target.offsetWidth;
        target.classList.add('fade-in');

        // Update step counter in UI (steps 0,1 → display as 1/2, 2/2)
        const counterEl = document.getElementById('onb-step-num');
        if (counterEl) {
            counterEl.textContent = stepNum + 1;
        }
    }

    // Hide success screen if we are navigating back to steps
    const successEl = document.getElementById('onb-success');
    if (successEl) successEl.style.display = 'none';

    // Step-specific initializations
    if (stepNum === 1) {
        const draft = loadDraft();
        updateExamLoopUI(_currentExamIndex, draft.examCount || 1);
    }
}

/**
 * Updates the exam loop UI: counter text and button label/styling.
 */
function updateExamLoopUI(currentIndex, totalCount) {
    const counterEl = document.getElementById('onb-exam-counter');
    const nextBtn = document.getElementById('onb-next-exam');

    if (counterEl) {
        counterEl.textContent = `Exam ${currentIndex + 1} of ${totalCount}`;
    }

    if (nextBtn) {
        const isLast = (currentIndex + 1 === totalCount);
        if (isLast) {
            nextBtn.textContent = 'Done! Build my schedule';
            nextBtn.className = 'w-full bg-gradient-to-r from-accent-500 to-purple-500 py-4 rounded-xl font-bold transition-all shadow-lg shadow-accent-500/30 text-lg';
        } else {
            nextBtn.textContent = 'Save and continue to next exam';
            nextBtn.className = 'w-full bg-accent-500 hover:bg-accent-600 py-3 rounded-xl font-bold transition-all';
        }
    }
}

/**
 * Initializes the onboarding screen: loads draft, wires events.
 */
export function initOnboarding() {
    const draft = loadDraft();

    // Reset exam loop index to match how many exams are already saved
    _currentExamIndex = draft.exams ? draft.exams.length : 0;

    // Wire up Icebreaker pre-step buttons
    setupIcebreaker();

    // Wire up profiling chips (Step 0)
    setupProfilingChips(draft);

    // Wire up Unified Exam Card (Step 1: exam details + file upload)
    setupUnifiedExamCard();

    // If examCount not yet set, show the icebreaker pre-step
    if (!draft.examCount) {
        showIcebreaker(true);
        return;
    }

    // Set to current step (step 2 is skipped — see setStep guard)
    const targetStep = draft.step === 2 ? 1 : draft.step;
    setStep(targetStep);
}

function setupProfilingChips(draft) {
    // Study Hours (Multi-select)
    const studyChips = document.querySelectorAll('.chip-study-hour');
    studyChips.forEach(chip => {
        const val = chip.dataset.value;
        if (draft.profiling.studyHours.includes(val)) {
            chip.classList.add('active');
        }

        // Use onclick (not addEventListener) to prevent handler accumulation on re-init
        chip.onclick = () => {
            const currentDraft = loadDraft();
            let studyHours = [...currentDraft.profiling.studyHours];

            if (studyHours.includes(val)) {
                studyHours = studyHours.filter(h => h !== val);
                chip.classList.remove('active');
            } else {
                studyHours.push(val);
                chip.classList.add('active');
            }

            saveDraft({ profiling: { ...currentDraft.profiling, studyHours } });
        };
    });
    
    // Neto Study Hours (Slider)
    const hoursSlider = document.getElementById('onb-study-hours');
    const hoursLabel = document.getElementById('onb-study-hours-label');
    const hoursValue = document.getElementById('onb-hours-value');
    if (hoursSlider) {
        hoursSlider.value = draft.profiling.netoStudyHours || 4.0;
        const initialVal = parseFloat(hoursSlider.value);
        if (hoursLabel) hoursLabel.textContent = initialVal.toFixed(1);
        if (hoursValue) hoursValue.textContent = Math.round(initialVal);
        hoursSlider.oninput = () => {
            const val = parseFloat(hoursSlider.value);
            if (hoursLabel) hoursLabel.textContent = val.toFixed(1);
            if (hoursValue) hoursValue.textContent = Math.round(val);
            const currentDraft = loadDraft();
            saveDraft({ profiling: { ...currentDraft.profiling, netoStudyHours: val } });
        };
    }

    // Buffer Days (Single-select)
    const bufferChips = document.querySelectorAll('.chip-buffer-day');
    bufferChips.forEach(chip => {
        const val = parseInt(chip.dataset.value);
        if (draft.profiling.bufferDays === val) {
            chip.classList.add('active');
        }
        
        chip.onclick = () => {
            bufferChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            const currentDraft = loadDraft();
            saveDraft({ profiling: { ...currentDraft.profiling, bufferDays: val } });
        };
    });
    
    // Next button for Step 0
    const btnNext0 = document.getElementById('onb-next-0');
    if (btnNext0) {
        btnNext0.onclick = () => {
            const currentDraft = loadDraft();
            if (currentDraft.profiling.studyHours.length === 0) {
                alert('Please select at least one study window.');
                return;
            }
            setStep(1);
        };
    }
}

/**
 * Sets up the unified exam card (Step 1): exam details + file upload in one screen.
 * Replaces the old separate setupExamInput() + setupMaterialUpload().
 */
function setupUnifiedExamCard() {
    const uploadArea = document.getElementById('onb-upload-area');
    const fileInput = document.getElementById('onb-file-input');
    const backBtn = document.getElementById('onb-back-1');
    const nextExamBtn = document.getElementById('onb-next-exam');
    const skipBtn = document.getElementById('onb-skip-remaining');
    const diffBtns = document.querySelectorAll('.onb-diff-btn');

    // Wire difficulty buttons using onclick (idempotent, matches codebase pattern)
    diffBtns.forEach(btn => {
        btn.onclick = () => {
            diffBtns.forEach(b => {
                b.classList.remove('active', 'bg-accent-500/20', 'border-accent-500/50');
                b.classList.add('bg-dark-900/50', 'border-white/5');
            });
            btn.classList.add('active', 'bg-accent-500/20', 'border-accent-500/50');
            btn.classList.remove('bg-dark-900/50', 'border-white/5');
        };
    });

    // Wire file upload area
    if (uploadArea && fileInput) {
        uploadArea.onclick = (e) => {
            // Only trigger file input if click isn't on a child button (remove button)
            if (e.target === uploadArea || uploadArea.contains(e.target)) {
                if (!e.target.closest('button') && !e.target.closest('select')) {
                    fileInput.click();
                }
            }
        };

        fileInput.onchange = (e) => {
            handleFiles(Array.from(e.target.files));
            fileInput.value = ''; // Reset for next selection
        };

        // Drag & Drop with glow feedback
        uploadArea.ondragover = (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        };
        uploadArea.ondragleave = (e) => {
            // Only remove on true leave (not child elements)
            if (!uploadArea.contains(e.relatedTarget)) {
                uploadArea.classList.remove('dragover');
            }
        };
        uploadArea.ondrop = (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            handleFiles(Array.from(e.dataTransfer.files));
        };
    }

    // Back button goes to step 0
    if (backBtn) {
        backBtn.onclick = () => {
            examFilesMap.delete(-1);
            renderFileList();
            setStep(0);
        };
    }

    // Main action button: "Save and continue" or "Done! Build my schedule"
    if (nextExamBtn) {
        nextExamBtn.onclick = async () => {
            const draft = loadDraft();
            const totalCount = draft.examCount || 1;
            const name = document.getElementById('onb-exam-name').value.trim();
            const date = document.getElementById('onb-exam-date').value;

            if (!name || !date) {
                alert('Please provide course name and exam date.');
                return;
            }

            // Get selected difficulty
            const activeDiff = document.querySelector('.onb-diff-btn.active');
            const difficulty = activeDiff ? parseInt(activeDiff.dataset.value) : 3;

            // Save current exam to draft
            saveExamToDraft(name, date, difficulty);

            const isLast = (_currentExamIndex + 1 >= totalCount);

            if (isLast) {
                // This was the last exam — submit
                await submitOnboarding();
            } else {
                // More exams remain — advance to next
                _currentExamIndex++;
                clearExamForm();
                updateExamLoopUI(_currentExamIndex, totalCount);
            }
        };
    }

    // Escape hatch: submit whatever has been collected so far
    if (skipBtn) {
        skipBtn.onclick = async () => {
            const name = document.getElementById('onb-exam-name').value.trim();
            const date = document.getElementById('onb-exam-date').value;

            // Save current exam only if it has at least name AND date
            if (name && date) {
                const activeDiff = document.querySelector('.onb-diff-btn.active');
                const difficulty = activeDiff ? parseInt(activeDiff.dataset.value) : 3;
                saveExamToDraft(name, date, difficulty);
            }

            const draft = loadDraft();
            if (!draft.exams || draft.exams.length === 0) {
                alert('Please fill in at least one exam before submitting.');
                return;
            }

            await submitOnboarding();
        };
    }
}

/**
 * Saves the current exam form data (including files from examFilesMap[-1]) to draft.
 */
function saveExamToDraft(name, date, difficulty) {
    const files = examFilesMap.get(-1) || [];
    const draft = loadDraft();
    const examIndex = _currentExamIndex;

    const newExam = {
        name,
        date,
        difficulty,
        materials: files.map(f => ({ name: f.file.name, type: f.tag }))
    };

    // Replace or add at current index
    if (draft.exams.length > examIndex) {
        draft.exams[examIndex] = newExam;
    } else {
        draft.exams.push(newExam);
    }

    saveDraft({ exams: draft.exams });

    // Move files from temp (-1) to actual exam index
    examFilesMap.set(examIndex, [...files]);
    examFilesMap.delete(-1);
}

/**
 * Clears the exam form for the next exam entry.
 */
function clearExamForm() {
    const nameEl = document.getElementById('onb-exam-name');
    const dateEl = document.getElementById('onb-exam-date');
    if (nameEl) nameEl.value = '';
    if (dateEl) dateEl.value = '';

    // Reset difficulty to 3
    const diffBtns = document.querySelectorAll('.onb-diff-btn');
    diffBtns.forEach(b => {
        b.classList.remove('active', 'bg-accent-500/20', 'border-accent-500/50');
        b.classList.add('bg-dark-900/50', 'border-white/5');
    });
    const d3 = document.querySelector('.onb-diff-btn[data-value="3"]');
    if (d3) {
        d3.classList.add('active', 'bg-accent-500/20', 'border-accent-500/50');
        d3.classList.remove('bg-dark-900/50', 'border-white/5');
    }

    // Clear file list for new exam
    examFilesMap.delete(-1);
    renderFileList();
}

function handleFiles(files) {
    const currentFiles = examFilesMap.get(-1) || [];

    // Pre-check: Block the entire batch if it exceeds the limit
    if (currentFiles.length + files.length > 3) {
        alert('Max 3 files per exam.');
        return;
    }

    for (const file of files) {
        // Default tag is "past_exam"
        currentFiles.push({ file, tag: 'past_exam' });
    }

    examFilesMap.set(-1, currentFiles);
    renderFileList();
}

function renderFileList() {
    const listEl = document.getElementById('onb-file-list');
    if (!listEl) return;

    const files = examFilesMap.get(-1) || [];
    listEl.innerHTML = '';

    files.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5';

        const isPdf = item.file.type === 'application/pdf';
        const icon = isPdf ? '📄' : '🖼️';

        row.innerHTML = `
            <div class="text-xl">${icon}</div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <div class="text-sm font-medium truncate">${item.file.name}</div>
                    <span class="text-green-500 text-sm flex-shrink-0">✓</span>
                </div>
                <select class="onb-tag-select bg-transparent text-xs text-white/40 border-none p-0 focus:ring-0">
                    <option value="past_exam" ${item.tag === 'past_exam' ? 'selected' : ''}>Past Exam</option>
                    <option value="syllabus" ${item.tag === 'syllabus' ? 'selected' : ''}>Syllabus</option>
                    <option value="notes" ${item.tag === 'notes' ? 'selected' : ''}>Formula Sheet</option>
                </select>
            </div>
            <button class="onb-remove-file p-2 text-white/20 hover:text-coral-400 transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        `;

        const select = row.querySelector('.onb-tag-select');
        select.onchange = (e) => {
            item.tag = e.target.value;
        };

        const removeBtn = row.querySelector('.onb-remove-file');
        removeBtn.onclick = () => {
            const currentFiles = examFilesMap.get(-1);
            currentFiles.splice(index, 1);
            examFilesMap.set(-1, currentFiles);
            renderFileList();
        };

        // Add pop-in animation for newly added rows
        row.classList.add('file-row-enter');

        listEl.appendChild(row);
    });
}

/**
 * Builds personalized loading messages using the user's course names.
 * Returns an array of { percent, text } objects.
 */
function buildLoadingMessages(courseNames) {
    const messages = [];
    messages.push({ percent: 5, text: 'Decoding the files you uploaded...' });

    const maxPerCourse = courseNames.length > 0 ? Math.min(courseNames.length, 4) : 0;
    courseNames.slice(0, maxPerCourse).forEach((name, i) => {
        const pct = Math.min(15 + (i * 12), 55);
        messages.push({ percent: pct, text: `Reading the syllabus of ${name}...` });
    });

    const lastCourse = courseNames.length > 0 ? courseNames[courseNames.length - 1] : 'your exams';
    messages.push({ percent: 70, text: `Detecting knowledge gaps and tricky questions in ${lastCourse}...` });
    messages.push({ percent: 85, text: 'Scheduling strategic reviews based on your study windows...' });
    messages.push({ percent: 95, text: 'Assembling your final action plan...' });

    return messages;
}

/**
 * Submits the entire onboarding package to the backend.
 */
async function submitOnboarding() {
    const draft = loadDraft();

    // Capture course names BEFORE any async op or clearDraft (prevents race condition)
    const courseNames = (draft.exams || []).map(e => e.name).filter(Boolean);
    const loadingMessages = buildLoadingMessages(courseNames);

    // Show loading overlay
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'flex';

    // Start personalized loading message cycling
    let msgIndex = 0;
    const loadingTextEl = document.getElementById('loading-text');
    const loadingStatusEl = document.getElementById('loading-status-text');
    const loadingProgressBar = document.getElementById('loading-progress-bar');
    const loadingProgressPct = document.getElementById('loading-progress-percent');

    function applyLoadingMessage(msg) {
        if (loadingTextEl) {
            loadingTextEl.classList.remove('status-fade');
            void loadingTextEl.offsetWidth; // force reflow
            loadingTextEl.textContent = msg.text;
            loadingTextEl.classList.add('status-fade');
        }
        if (loadingProgressBar) {
            loadingProgressBar.style.width = `${msg.percent}%`;
        }
        if (loadingProgressPct) {
            loadingProgressPct.textContent = `${msg.percent}%`;
        }
    }

    // Apply first message immediately
    if (loadingMessages.length > 0) {
        applyLoadingMessage(loadingMessages[0]);
        msgIndex = 1;
    }

    _loadingInterval = setInterval(() => {
        if (msgIndex < loadingMessages.length) {
            applyLoadingMessage(loadingMessages[msgIndex]);
            msgIndex++;
        }
    }, 2700);

    const API = getAPI();

    try {
        const formData = new FormData();

        // 1. Construct Onboard Request with defaults for required fields
        const onboardRequest = {
            // Profile Defaults + Collected Data
            wake_up_time: "07:00",
            sleep_time: "23:00",
            study_method: "continuous",
            session_minutes: 90,
            break_minutes: 10,
            hobby_name: "Hobbies",
            neto_study_hours: draft.profiling.netoStudyHours || 4.0,
            study_hours_preference: JSON.stringify(draft.profiling.studyHours),
            buffer_days: draft.profiling.bufferDays,
            timezone_offset: new Date().getTimezoneOffset(),

            // Exams
            exams: []
        };

        // 2. Map exams and build file list
        let globalFileIdx = 0;
        draft.exams.forEach((exam, examIdx) => {
            const files = examFilesMap.get(examIdx) || [];

            const examEntry = {
                name: exam.name,
                subject: "General",
                exam_date: exam.date,
                special_needs: `Difficulty: ${exam.difficulty}/5`,
                file_indices: [],
                file_types: []
            };

            files.forEach(f => {
                formData.append('files', f.file);
                examEntry.file_indices.push(globalFileIdx);
                examEntry.file_types.push(f.tag);
                globalFileIdx++;
            });

            onboardRequest.exams.push(examEntry);
        });

        formData.append('onboard_data', JSON.stringify(onboardRequest));

        const response = await authFetch(`${API}/brain/onboard`, {
            method: 'POST',
            body: formData,
        });

        // Clear loading interval regardless of success/failure
        if (_loadingInterval) {
            clearInterval(_loadingInterval);
            _loadingInterval = null;
        }

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Onboarding failed');
        }

        const data = await response.json();

        // Success!
        clearDraft();
        _currentExamIndex = 0;

        // Hide loading overlay
        if (overlay) overlay.style.display = 'none';

        // Update user state so refresh won't loop back to onboarding
        try {
            const meRes = await authFetch(`${API}/auth/me`);
            if (meRes.ok) {
                const freshUser = await meRes.json();
                setCurrentUser(freshUser);
            }
        } catch (_) {}

        // Show the Auditor Review screen with the generated roadmap
        if (data.tasks && data.tasks.length > 0) {
            window._auditorDraft = data;
            renderAuditorReview(data);
            showScreen('screen-auditor-review');
        } else {
            // Fallback: show success state if no tasks were generated
            document.querySelectorAll('.onb-step').forEach(el => el.style.display = 'none');
            const successEl = document.getElementById('onb-success');
            if (successEl) {
                successEl.style.display = 'block';
                successEl.classList.add('fade-in');
            }

            const doneBtn = document.getElementById('onb-done');
            if (doneBtn) {
                doneBtn.onclick = () => {
                    showScreen('screen-dashboard');
                    window.location.reload();
                };
            }
        }

    } catch (error) {
        // Clear loading interval on error too
        if (_loadingInterval) {
            clearInterval(_loadingInterval);
            _loadingInterval = null;
        }
        if (overlay) overlay.style.display = 'none';

        console.error('Submission error:', error);
        alert(`Error: ${error.message}`);

        // Re-show the exam step so user can try again
        setStep(1);
        const draft2 = loadDraft();
        updateExamLoopUI(_currentExamIndex, draft2.examCount || 1);
    }
}
