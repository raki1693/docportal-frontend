/**
 * anti-capture.js
 * DocPortal — Screenshot & Screen Recording Protection
 * Applies to all pages: index, admin, user
 */
(function () {
    'use strict';

    // ── 1. Warning Overlay ────────────────────────────────────────────────────
    function showCaptureWarning(msg) {
        // Remove existing warning if any
        const old = document.getElementById('__dp_warn');
        if (old) old.remove();

        const overlay = document.createElement('div');
        overlay.id = '__dp_warn';
        overlay.style.cssText = [
            'position:fixed', 'inset:0', 'z-index:2147483647',
            'background:rgba(0,0,0,0.92)',
            'display:flex', 'flex-direction:column',
            'align-items:center', 'justify-content:center',
            'color:#fff', 'font-family:sans-serif',
            'text-align:center', 'padding:2rem',
            'backdrop-filter:blur(10px)'
        ].join(';');
        overlay.innerHTML = `
            <div style="font-size:3rem;margin-bottom:1rem;">🚫</div>
            <div style="font-size:1.25rem;font-weight:700;color:#f87171;margin-bottom:0.5rem;">
                Action Blocked
            </div>
            <div style="font-size:0.95rem;color:#cbd5e1;max-width:320px;">
                ${msg || 'Screenshots and screen recording are not permitted on this platform.'}
            </div>
        `;
        document.body.appendChild(overlay);
        setTimeout(() => { if (overlay.parentNode) overlay.remove(); }, 2500);
    }

    // ── 2. Block Keyboard Shortcuts ───────────────────────────────────────────
    document.addEventListener('keydown', function (e) {
        const key = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        // Print Screen
        if (key === 'PrintScreen' || key === 'Print') {
            e.preventDefault();
            e.stopPropagation();
            // Wipe clipboard in case browser already put it there
            try { navigator.clipboard.writeText(''); } catch (_) { }
            showCaptureWarning('Screenshot key is blocked on this platform.');
            return false;
        }

        // F12 — DevTools
        if (key === 'F12') {
            e.preventDefault();
            return false;
        }

        // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C — DevTools
        if (ctrl && shift && ['i', 'I', 'j', 'J', 'c', 'C'].includes(key)) {
            e.preventDefault();
            return false;
        }

        // Ctrl+U — View Source
        if (ctrl && (key === 'u' || key === 'U')) {
            e.preventDefault();
            return false;
        }

        // Ctrl+S — Save Page
        if (ctrl && (key === 's' || key === 'S')) {
            e.preventDefault();
            return false;
        }

        // Ctrl+P — Print / Print to PDF (common screenshot workaround)
        if (ctrl && (key === 'p' || key === 'P')) {
            e.preventDefault();
            showCaptureWarning('Printing is disabled on this platform.');
            return false;
        }

        // Windows Snipping Tool: Win+Shift+S fires no keydown event we can block,
        // but we blur content on focus loss (see section 4).
    }, true); // capture phase so we get it before any other handler

    // ── 3. Disable Right-Click (Context Menu) ─────────────────────────────────
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        return false;
    });

    // ── 4. Blur Content on Focus Loss / Visibility Change ────────────────────
    //    This defeats screen-recording software that records while the tab is
    //    "in the background" and also defeats some capture tools that require
    //    the user to switch windows.
    const BLUR_STYLE = 'blur(15px) brightness(0.2)';

    function blurPage() {
        document.documentElement.style.filter = BLUR_STYLE;
        document.documentElement.style.transition = 'filter 0.15s ease';
    }

    function unblurPage() {
        document.documentElement.style.filter = '';
    }

    window.addEventListener('blur', blurPage);
    window.addEventListener('focus', unblurPage);

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            blurPage();
        } else {
            unblurPage();
        }
    });

    // ── 5. Block Print (CSS @media print handled in style.css too) ────────────
    window.addEventListener('beforeprint', function (e) {
        e.preventDefault();
        showCaptureWarning('Printing is disabled on this platform.');
        // Immediately cancel
        window.stop && window.stop();
        return false;
    });

    // ── 6. Disable Image Dragging ─────────────────────────────────────────────
    document.addEventListener('dragstart', function (e) {
        if (e.target.tagName === 'IMG' || e.target.tagName === 'A') {
            e.preventDefault();
        }
    });

    // ── 7. Detect Browser-Based Screen Capture (getDisplayMedia) ─────────────
    //    This intercepts if someone tries to share/record the screen FROM the
    //    *same browser* using the Screen Capture API.
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        const _original = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = function (constraints) {
            showCaptureWarning('Screen capture from this browser is not permitted.');
            return Promise.reject(new DOMException('Screen capture blocked by DocPortal.', 'NotAllowedError'));
        };
    }

    // ── 8. CSS Injection ──────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.id = '__dp_anti_capture_css';
    style.textContent = `
        /* Prevent text selection across the page */
        body, body * {
            -webkit-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            user-select: none !important;
        }
        /* But allow selection inside inputs and textareas */
        input, textarea, [contenteditable="true"] {
            -webkit-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
            user-select: text !important;
        }
        /* Prevent image dragging */
        img {
            -webkit-user-drag: none;
            user-drag: none;
            pointer-events: none;
        }
        /* Hide everything when printing */
        @media print {
            html, body {
                display: none !important;
                visibility: hidden !important;
            }
        }
    `;
    document.head.appendChild(style);

    console.log('%c⛔ DocPortal Security Active', 'color:#f87171;font-size:14px;font-weight:bold;');

})();
