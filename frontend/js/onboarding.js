/* frontend/js/onboarding.js */
import { getAPI, authFetch, setCurrentUser, setCurrentExams, setCurrentSchedule } from './store.js?v=59';
import { showScreen, LoadingAnimator } from './ui.js?v=59';
import { renderAuditorReview } from './tasks.js?v=59';

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

// Module-level variable to hold the current exam being added (replaces window._onb_current_exam)
let _currentExamDraft = null;

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

/**
 * Navigation: Sets the active step in the wizard.
 */
export function setStep(stepNum) {
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
        
        // Update step counter in UI (steps 0,1,2 → display as 1/3, 2/3, 3/3)
        const counterEl = document.getElementById('onb-step-num');
        if (counterEl) {
            counterEl.textContent = stepNum + 1;
        }
    }

    // Hide success screen if we are navigating back to steps
    const successEl = document.getElementById('onb-success');
    if (successEl) successEl.style.display = 'none';

    // Step-specific initializations
    if (stepNum === 2) {
        updateMaterialScreen();
    }
}

/**
 * Initializes the onboarding screen: loads draft, wires events.
 */
export function initOnboarding() {
    const draft = loadDraft();

    // Wire up Icebreaker pre-step buttons
    setupIcebreaker();

    // Wire up profiling chips (Step 0)
    setupProfilingChips(draft);

    // Wire up Exam Input (Step 1)
    setupExamInput();

    // Wire up Material Upload (Step 2)
    setupMaterialUpload();

    // If examCount not yet set, show the icebreaker pre-step
    if (!draft.examCount) {
        showIcebreaker(true);
        return;
    }

    // Set to current step
    setStep(draft.step);
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

function setupExamInput() {
    const nextBtn = document.getElementById('onb-next-1');
    const backBtn = document.getElementById('onb-back-1');
    const diffBtns = document.querySelectorAll('.onb-diff-btn');
    
    let selectedDiff = 3;

    diffBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            diffBtns.forEach(b => {
                b.classList.remove('active', 'bg-accent-500/20', 'border-accent-500/50');
                b.classList.add('bg-dark-900/50', 'border-white/5');
            });
            btn.classList.add('active', 'bg-accent-500/20', 'border-accent-500/50');
            btn.classList.remove('bg-dark-900/50', 'border-white/5');
            selectedDiff = parseInt(btn.dataset.value);
        });
    });

    if (nextBtn) {
        nextBtn.onclick = () => {
            const name = document.getElementById('onb-exam-name').value.trim();
            const date = document.getElementById('onb-exam-date').value;
            
            if (!name || !date) {
                alert('Please provide course name and exam date.');
                return;
            }
            
            // Temporary store for the current exam being added
            _currentExamDraft = {
                name,
                date,
                difficulty: selectedDiff
            };
            
            setStep(2);
        };
    }

    if (backBtn) {
        backBtn.onclick = () => setStep(0);
    }
}

function setupMaterialUpload() {
    const uploadArea = document.getElementById('onb-upload-area');
    const fileInput = document.getElementById('onb-file-input');
    const addAnotherBtn = document.getElementById('onb-add-another');
    const submitBtn = document.getElementById('onb-submit-all');
    const backBtn = document.getElementById('onb-back-2');

    if (uploadArea && fileInput) {
        uploadArea.onclick = () => fileInput.click();
        
        fileInput.onchange = (e) => {
            handleFiles(Array.from(e.target.files));
            fileInput.value = ''; // Reset for next selection
        };

        // Drag & Drop
        uploadArea.ondragover = (e) => {
            e.preventDefault();
            uploadArea.classList.add('border-accent-500', 'bg-accent-500/10');
        };
        uploadArea.ondragleave = () => {
            uploadArea.classList.remove('border-accent-500', 'bg-accent-500/10');
        };
        uploadArea.ondrop = (e) => {
            e.preventDefault();
            uploadArea.classList.remove('border-accent-500', 'bg-accent-500/10');
            handleFiles(Array.from(e.dataTransfer.files));
        };
    }

    if (addAnotherBtn) {
        addAnotherBtn.onclick = () => {
            if (saveCurrentExam()) {
                // Clear form for next exam
                document.getElementById('onb-exam-name').value = '';
                document.getElementById('onb-exam-date').value = '';
                // Reset difficulty to 3
                const d3 = document.querySelector('.onb-diff-btn[data-value="3"]');
                if (d3) d3.click();
                setStep(1);
            }
        };
    }

    if (submitBtn) {
        submitBtn.onclick = async () => {
            if (saveCurrentExam()) {
                await submitOnboarding();
            }
        };
    }

    if (backBtn) {
        backBtn.onclick = () => setStep(1);
    }
}

function handleFiles(files) {
    const currentFiles = examFilesMap.get(-1) || [];
    
    for (const file of files) {
        if (currentFiles.length >= 3) {
            alert('Max 3 files per exam.');
            break;
        }
        
        // Default tag is "past_exam" (mapped from "Past Exam" label)
        currentFiles.push({ file, tag: 'past_exam' });
    }
    
    examFilesMap.set(-1, currentFiles);
    renderFileList();
    validateMaterialStep();
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
                <div class="text-sm font-medium truncate">${item.file.name}</div>
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
            validateMaterialStep();
        };
        
        listEl.appendChild(row);
    });
}

function validateMaterialStep() {
    const files = examFilesMap.get(-1) || [];
    const submitBtn = document.getElementById('onb-submit-all');
    const hasFiles = files.length >= 1 && files.length <= 3;
    
    if (submitBtn) {
        submitBtn.disabled = !hasFiles;
    }
}

function updateMaterialScreen() {
    const nameEl = document.getElementById('onb-current-exam-name');
    if (nameEl && _currentExamDraft) {
        nameEl.textContent = _currentExamDraft.name;
    }
    renderFileList();
    validateMaterialStep();
}

/**
 * Saves the current exam (info + files) into the draft state.
 */
function saveCurrentExam() {
    const examInfo = _currentExamDraft;
    const files = examFilesMap.get(-1) || [];

    if (!examInfo) return false;
    if (files.length < 1) {
        alert('Please upload at least one material for this exam.');
        return false;
    }

    const draft = loadDraft();
    const examIndex = draft.exams.length;

    // Store metadata in draft
    const newExam = {
        ...examInfo,
        materials: files.map(f => ({ name: f.file.name, type: f.tag }))
    };

    draft.exams.push(newExam);
    saveDraft({ exams: draft.exams });

    // Move files from temp (-1) to actual index
    examFilesMap.set(examIndex, [...files]);
    examFilesMap.delete(-1);

    _currentExamDraft = null;
    return true;
}

/**
 * Submits the entire onboarding package to the backend.
 */
async function submitOnboarding() {
    const draft = loadDraft();
    const btn = document.getElementById('onb-submit-all');
    if (!btn) return;
    const originalText = btn.textContent;
    const API = getAPI();

    try {
        btn.disabled = true;
        btn.textContent = 'Generating Roadmap...';
        
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
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Onboarding failed');
        }
        
        const data = await response.json();

        // Success!
        clearDraft();

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
        console.error('Submission error:', error);
        alert(`Error: ${error.message}`);
        btn.disabled = false;
        btn.textContent = originalText;
    }
}
