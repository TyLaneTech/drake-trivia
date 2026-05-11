/* Drake Trivia — shared helpers loaded on every page. */

(() => {
    'use strict';

    const NS = window.dt = window.dt || {};

    NS.formatTime = (s) => {
        if (s == null || isNaN(s)) return '--';
        s = Math.max(0, Math.round(s));
        return `${s}`;
    };

    NS.escapeHtml = (str) => String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    NS.fetchJSON = async (url, init = {}) => {
        const opts = { credentials: 'same-origin', ...init };
        if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
            opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
            opts.body = JSON.stringify(opts.body);
        }
        const resp = await fetch(url, opts);
        const ct = resp.headers.get('content-type') || '';
        const data = ct.includes('application/json') ? await resp.json() : await resp.text();
        if (!resp.ok) {
            const err = new Error((data && data.error) || `HTTP ${resp.status}`);
            err.status = resp.status; err.data = data;
            throw err;
        }
        return data;
    };

    NS.connectSocket = (handlers) => {
        if (typeof io === 'undefined') {
            console.error('socket.io not loaded');
            return null;
        }
        const sock = io({
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 800,
        });
        if (handlers) {
            for (const [evt, fn] of Object.entries(handlers)) sock.on(evt, fn);
        }
        return sock;
    };
})();
