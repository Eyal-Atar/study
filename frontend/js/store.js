/* frontend/js/store.js */

const store = {
    API: window.location.origin,
    authToken: localStorage.getItem('studyflow_token'),
    currentUser: null,
    currentExams: [],
    currentTasks: [],
    currentSchedule: [],
    pendingExamId: null,
    pendingFiles: [],
    brainChatHistory: []
};

export const getAPI = () => store.API;

export const getAuthToken = () => store.authToken;
export const setAuthToken = (token) => {
    store.authToken = token;
    if (token) {
        localStorage.setItem('studyflow_token', token);
    } else {
        localStorage.removeItem('studyflow_token');
    }
};

export const getCurrentUser = () => store.currentUser;
export const setCurrentUser = (user) => { store.currentUser = user; };

export const getCurrentExams = () => store.currentExams;
export const setCurrentExams = (exams) => { store.currentExams = exams; };

export const getCurrentTasks = () => store.currentTasks;
export const setCurrentTasks = (tasks) => { store.currentTasks = tasks; };

export const getPendingExamId = () => store.pendingExamId;
export const setPendingExamId = (id) => { store.pendingExamId = id; };

export const getPendingFiles = () => store.pendingFiles;
export const setPendingFiles = (files) => { store.pendingFiles = files; };

export const getBrainChatHistory = () => store.brainChatHistory;
export const setBrainChatHistory = (history) => { store.brainChatHistory = history; };

export function authHeaders() {
    const token = getAuthToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

export function authFetch(url, opts = {}) {
    opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
    return fetch(url, opts);
}
