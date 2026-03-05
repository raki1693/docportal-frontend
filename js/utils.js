// =========================================
// DocPortal - Shared Utilities
// =========================================

const API_BASE = 'https://docportal-backend.onrender.com/api';
const UPLOADS_BASE = 'https://docportal-backend.onrender.com/uploads';

// Auth helpers
const Auth = {
    setToken: (token) => localStorage.setItem('dp_token', token),
    getToken: () => localStorage.getItem('dp_token'),
    setUser: (user) => localStorage.setItem('dp_user', JSON.stringify(user)),
    getUser: () => {
        const u = localStorage.getItem('dp_user');
        return u ? JSON.parse(u) : null;
    },
    clear: () => {
        localStorage.removeItem('dp_token');
        localStorage.removeItem('dp_user');
    },
    isLoggedIn: () => !!localStorage.getItem('dp_token'),
    isAdmin: () => {
        const u = Auth.getUser();
        return u && u.role === 'admin';
    }
};

// Helper: get the correct login page path from any sub-directory
function getLoginPath() {
    return window.location.pathname.includes('/pages/') ? '../index.html' : 'index.html';
}

// API request helper
async function apiRequest(endpoint, method = 'GET', body = null, isFormData = false) {
    const headers = {};
    const token = Auth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) opts.body = isFormData ? body : JSON.stringify(body);

    const res = await fetch(`${API_BASE}${endpoint}`, opts);
    const data = await res.json();

    // ── 401: Token missing or expired ──────────────────────────────────────
    // Silently redirect to login instead of showing a confusing toast.
    // Exceptions: /auth/ endpoints return 401 for wrong password — don't redirect those.
    if (res.status === 401 && !endpoint.startsWith('/auth/')) {
        Auth.clear();
        window.location.href = getLoginPath();
        // Return a never-resolving promise so the calling code stops executing
        return new Promise(() => { });
    }

    if (!res.ok) throw { status: res.status, ...data };
    return data;
}

// Toast notifications
const Toast = {
    container: null,
    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    },
    show(message, type = 'info', duration = 3500) {
        this.init();
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${message}</span>`;
        this.container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('fadeout');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },
    success: (msg) => Toast.show(msg, 'success'),
    error: (msg) => Toast.show(msg, 'error'),
    warning: (msg) => Toast.show(msg, 'warning'),
    info: (msg) => Toast.show(msg, 'info')
};

// Format file size
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// Format date
function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Format time remaining (for active countdowns)
function formatTimeRemaining(ms) {
    if (ms <= 0) return 'Expired';
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

// Format a duration in minutes as a digital clock: HH:MM:SS
// Used to display the configured timer before the user has logged in
function formatDuration(totalMinutes) {
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const secs = 0;
    const hh = String(hrs).padStart(2, '0');
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
}

// Get file icon based on type
function getFileIcon(fileType, mimetype) {
    if (fileType === 'image') return '🖼️';
    if (fileType === 'pdf') return '📄';
    if (fileType === 'word') return '📝';
    if (mimetype && mimetype.includes('excel')) return '📊';
    if (mimetype && mimetype.includes('powerpoint')) return '📑';
    return '📁';
}

// Set active nav item
function setActiveNav(id) {
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

// Show section
function showSection(id) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

// =========================================
// SECURITY - Disable Inspect & DevTools
// =========================================
(function () {
    // 1. Disable Right Click
    document.addEventListener('contextmenu', e => e.preventDefault());

    // 2. Disable Keyboard Shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U)
    document.addEventListener('keydown', e => {
        if (
            e.key === 'F12' ||
            (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
            (e.ctrlKey && (e.key === 'U' || e.key === 'u'))
        ) {
            e.preventDefault();
            return false;
        }
    });

    // 3. Anti-DevTools Debugger Loop
    // This pauses the page if DevTools is open, making it impossible to use.
    // If a debugger is active, the time difference between startTime and endTime will be significant.
    const blockDevTools = function () {
        const startTime = performance.now();
        debugger;
        const endTime = performance.now();
        if (endTime - startTime > 100) {
            // DevTools detected (debugger caused a pause)
            document.body.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0a0a1a;color:#f87171;font-family:'Outfit',sans-serif;text-align:center;padding:2rem;">
                    <div style="font-size:5rem;margin-bottom:1rem;">🚫</div>
                    <h1 style="font-size:2rem;margin-bottom:1rem;color:#fff;">Security Violation</h1>
                    <p style="color:#94a3b8;max-width:400px;line-height:1.6;">
                        Developer Tools are strictly prohibited on this portal. 
                        Please <b>close the inspection window</b> and refresh the page to continue.
                    </p>
                    <button onclick="window.location.reload()" class="btn btn-primary" style="margin-top:2rem;width:auto;min-width:200px;background:linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);color:white;border:none;padding:0.75rem 1.5rem;border-radius:8px;cursor:pointer;font-weight:600;">🔄 Refresh Page</button>
                </div>`;
        }
    };
    setInterval(blockDevTools, 1000);
})();
