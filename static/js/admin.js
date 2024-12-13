/* static/js/admin.js */

document.addEventListener('DOMContentLoaded', function() {
    const adminRoot = document.getElementById('admin-container');
    const adminDashboardRoot = document.getElementById('admin-dashboard-container');

    if (adminRoot) {
        // We're on the admin login/setup page
        let isNewSetup = false;
        let error = '';

        // Check if admin exists
        fetch('/api/admin/check')
            .then(response => response.json())
            .then(data => {
                isNewSetup = !data.exists;
                renderAdminForm();
            })
            .catch(err => {
                error = 'Failed to check admin status';
                renderAdminForm();
            });

        function renderAdminForm() {
            const formHtml = `
                <div class="admin-setup-container">
                    <div class="admin-setup-card">
                        <h2 class="text-center mb-4">${isNewSetup ? 'Create Admin Account' : 'Admin Login'}</h2>

                        ${error ? `<div class="error-message">${error}</div>` : ''}

                        <form id="adminForm" class="admin-form">
                            <div>
                                <label>Username</label>
                                <input
                                    type="text"
                                    name="username"
                                    class="admin-input"
                                    required
                                />
                            </div>

                            <div>
                                <label>Password</label>
                                <input
                                    type="password"
                                    name="password"
                                    class="admin-input"
                                    required
                                />
                            </div>

                            ${isNewSetup ? `
                                <div>
                                    <label>Confirm Password</label>
                                    <input
                                        type="password"
                                        name="confirmPassword"
                                        class="admin-input"
                                        required
                                    />
                                </div>
                            ` : ''}

                            <button type="submit" class="admin-button">
                                ${isNewSetup ? 'Create Account' : 'Login'}
                            </button>
                        </form>
                    </div>
                </div>
            `;

            adminRoot.innerHTML = formHtml;

            // Add form submission handler
            const form = document.getElementById('adminForm');
            form.addEventListener('submit', handleSubmit);
        }

        async function handleSubmit(e) {
            e.preventDefault();
            error = '';

            const formData = new FormData(e.target);
            const data = {
                username: formData.get('username'),
                password: formData.get('password')
            };

            if (isNewSetup) {
                const confirmPassword = formData.get('confirmPassword');
                if (data.password !== confirmPassword) {
                    error = 'Passwords do not match';
                    renderAdminForm();
                    return;
                }
            }

            try {
                const endpoint = isNewSetup ? '/api/admin/setup' : '/admin-login';
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(data),
                });

                const responseData = await response.json();

                if (response.ok && responseData.redirect) {
                    window.location.href = responseData.redirect;
                } else {
                    error = responseData.error || 'An error occurred';
                    renderAdminForm();
                }
            } catch (err) {
                error = 'Failed to process request';
                renderAdminForm();
            }
        }
    } else if (adminDashboardRoot) {
        // We're on the admin dashboard page
        // Implement admin dashboard functionalities here

        // Example: Fetch and display questions
        fetch('/api/admin/questions')
            .then(response => response.json())
            .then(data => {
                renderQuestions(data);
            })
            .catch(err => {
                adminDashboardRoot.innerHTML = '<p>Error loading questions.</p>';
            });

        function renderQuestions(questions) {
            let html = '<h2>Questions</h2>';
            html += '<ul>';
            questions.forEach(q => {
                html += `<li>${q.question_text}</li>`;
            });
            html += '</ul>';
            adminDashboardRoot.innerHTML = html;
        }

        // Additional admin functionalities can be added here
    }
});
