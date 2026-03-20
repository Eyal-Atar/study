/* frontend/js/store.js */

const store = {
    API: window.location.origin,
    currentUser: null,
    currentExams: [],
    currentTasks: [],
    currentSchedule: [],
    pendingExamId: null,
    pendingFiles: [],
    brainChatHistory: [],
    regenTriggered: false,
    regenTriggerLabel: '',
};

export const getAPI = () => store.API;

// Token management removed - using HttpOnly cookies instead

export const getCurrentUser = () => store.currentUser;
export const setCurrentUser = (user) => { 
    store.currentUser = user; 
    window.dispatchEvent(new CustomEvent('sf:user-changed', { detail: user }));
};

export const getCurrentExams = () => store.currentExams;
export const setCurrentExams = (exams) => { 
    store.currentExams = exams; 
    window.dispatchEvent(new CustomEvent('sf:exams-changed', { detail: exams }));
};

export const getCurrentTasks = () => store.currentTasks;
export const setCurrentTasks = (tasks) => { 
    store.currentTasks = tasks; 
    window.dispatchEvent(new CustomEvent('sf:tasks-changed', { detail: tasks }));
};

export const getCurrentSchedule = () => store.currentSchedule;
export const setCurrentSchedule = (schedule) => { 
    store.currentSchedule = schedule; 
    window.dispatchEvent(new CustomEvent('sf:schedule-changed', { detail: schedule }));
};

export const getPendingExamId = () => store.pendingExamId;
export const setPendingExamId = (id) => { store.pendingExamId = id; };

export const getPendingFiles = () => store.pendingFiles;
export const setPendingFiles = (files) => { store.pendingFiles = files; };

export const getBrainChatHistory = () => store.brainChatHistory;
export const setBrainChatHistory = (history) => { store.brainChatHistory = history; };

export const resetStore = () => {
    store.currentUser = null;
    store.currentExams = [];
    store.currentTasks = [];
    store.currentSchedule = [];
    store.pendingExamId = null;
    store.pendingFiles = [];
    store.brainChatHistory = [];
    store.regenTriggered = false;
    store.regenTriggerLabel = '';
    // Note: session_token cookie is cleared by backend on logout
};

export function authHeaders() {
    // No longer needed - authentication via HttpOnly cookies
    return {};
}

export function authFetch(url, opts = {}) {
    // Include credentials to send cookies with requests
    opts.credentials = 'include';
    opts.headers = { ...(opts.headers || {}) };

    // CSRF Protection: Read csrf_token from cookie and send as header
    const cookies = document.cookie.split(';').reduce((acc, c) => {
        const [k, ...rest] = c.trim().split('=');
        acc[k] = decodeURIComponent(rest.join('='));
        return acc;
    }, {});
    
    if (cookies['csrf_token']) {
        opts.headers['X-CSRF-Token'] = cookies['csrf_token'];
    }

    return fetch(url, opts);
}

export const getRegenTriggered = () => store.regenTriggered;
export const setRegenTriggered = (val, label = '') => {
    store.regenTriggered = val;
    store.regenTriggerLabel = label;
};
export const getRegenTriggerLabel = () => store.regenTriggerLabel;

export function getTodayStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
