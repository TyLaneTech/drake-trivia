/* static/js/navbar.js */
document.addEventListener('DOMContentLoaded', function() {
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');

    const sidebarCollapsed = true;
    if (sidebarCollapsed) {
        sidebar.classList.add('collapsed');
        sidebarToggle.classList.remove('active');
    } else {
        sidebarToggle.classList.add('active');
    }

    // Toggle sidebar
    sidebarToggle.addEventListener('click', function() {
        sidebar.classList.toggle('collapsed');
        this.classList.toggle('active');
    });

    // Close sidebar on mobile when clicking outside
    document.addEventListener('click', function(event) {
        const isClickInside = sidebar.contains(event.target) || sidebarToggle.contains(event.target);

        if (!isClickInside && window.innerWidth <= 768 && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
            sidebarToggle.classList.remove('active');
            localStorage.setItem('sidebarCollapsed', 'true');
        }
    });
});
