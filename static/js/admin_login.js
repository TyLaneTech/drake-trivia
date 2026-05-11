(() => {
    'use strict';
    const form = document.getElementById('admin-form');
    const errBox = document.getElementById('admin-error');
    const tag = document.getElementById('admin-tagline');
    const btn = document.getElementById('admin-submit');

    const showError = (msg) => {
        errBox.textContent = msg;
        errBox.hidden = false;
    };

    // Detect first-time setup so we can tweak copy
    dt.fetchJSON('/api/admin/check').then(({ exists }) => {
        if (!exists) {
            tag.textContent = "First time? Create the host account by signing in below.";
            btn.textContent = 'Create host account';
        }
    }).catch(() => { /* ignore */ });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.hidden = true;
        btn.disabled = true;
        btn.textContent = 'Signing in…';
        try {
            const data = await dt.fetchJSON('/admin-login', {
                method: 'POST',
                body: {
                    username: document.getElementById('admin-username').value.trim(),
                    password: document.getElementById('admin-password').value,
                },
            });
            window.location = data.redirect || '/admin';
        } catch (err) {
            showError(err.message || 'Sign in failed');
            btn.disabled = false;
            btn.textContent = 'Sign in';
        }
    });
})();
