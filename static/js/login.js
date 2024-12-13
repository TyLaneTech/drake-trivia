/* static/js/login.js */

document.addEventListener('DOMContentLoaded', function() {
    const teamLoginForm = document.getElementById('team-login-form');
    const adminLoginLink = document.getElementById('admin-login-link');
    const adminLoginForm = document.getElementById('admin-login-form');

    // Team Login Form Submission
    if (teamLoginForm) {
        teamLoginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const teamSelect = document.getElementById('team-select');
            const teamName = teamSelect.value;

            if (!teamName) {
                showError('Please select a team.', '#team-login-form');
                return;
            }

            try {
                const formData = new FormData();
                formData.append('team_name', teamName);

                const response = await fetch('/login', {
                    method: 'POST',
                    body: formData
                });

                if (response.redirected) {
                    window.location.href = response.url;
                } else {
                    const data = await response.json();
                    if (data.error) {
                        showError(data.error, '#team-login-form');
                    }
                }
            } catch (error) {
                showError('An error occurred during login', '#team-login-form');
            }
        });
    }

    // Show/Hide Admin Login Form
    if (adminLoginLink && adminLoginForm) {
        adminLoginLink.addEventListener('click', function(e) {
            e.preventDefault();
            adminLoginForm.style.display = adminLoginForm.style.display === 'none' ? 'block' : 'none';
        });

        // Admin Login Form Submission
        adminLoginForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            const username = document.getElementById('admin-username').value;
            const password = document.getElementById('admin-password').value;

            if (!username || !password) {
                showError('Please enter both username and password.', '#admin-login-form');
                return;
            }

            try {
                const response = await fetch('/admin-login', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ username, password })
                });

                const data = await response.json();

                if (response.ok) {
                    if (data.redirect) {
                        window.location.href = data.redirect;
                    } else {
                        showError('Unknown error occurred.', '#admin-login-form');
                    }
                } else {
                    showError(data.error || 'Invalid credentials.', '#admin-login-form');
                }
            } catch (error) {
                showError('An error occurred during admin login.', '#admin-login-form');
            }
        });
    }

    function showError(message, formSelector) {
        let form = document.querySelector(formSelector);
        let errorDiv = form.querySelector('.login-error');
        if (!errorDiv) {
            errorDiv = document.createElement('div');
            errorDiv.className = 'login-error';
            form.insertBefore(errorDiv, form.firstChild);
        }
        errorDiv.textContent = message;
    }
});
