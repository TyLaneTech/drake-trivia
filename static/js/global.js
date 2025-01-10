/* static/js/global.js */

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    initializeApp();
    handleSidebarState();
    //initializeSocketConnection();
});


// Core initialization
function initializeApp() {
    // Set up any global event listeners
    document.addEventListener('keydown', handleKeyboardShortcuts);

    // Handle responsive sidebar
    const mainContent = document.querySelector('.main-content');
    const sidebar = document.querySelector('.sidebar');

    if (sidebar && sidebar.classList.contains('collapsed')) {
        mainContent?.classList.add('sidebar-collapsed');
    }
}

// Handle keyboard shortcuts
function handleKeyboardShortcuts(e) {
    // Example: Toggle sidebar with Ctrl + B
    if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        document.getElementById('sidebar-toggle')?.click();
    }
}

// Manage sidebar state
function handleSidebarState() {
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
}

// Socket.IO connection handling
function initializeSocketConnection() {
    // Only initialize Socket.IO if it's available
    if (typeof io !== 'undefined') {
        const socket = io();

        socket.on('connect', () => {
            console.log('Socket connected');
        });

        socket.on('disconnect', () => {
            console.log('Socket disconnected');
        });

        // Make socket available globally
        window.gameSocket = socket;
    }
}



// Utility functions
const utils = {
    // Debounce function for performance optimization
    debounce: (fn, delay) => {
        let timeoutId;
        return (...args) => {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => fn(...args), delay);
        };
    },

    // Format date/time consistently
    formatDate: (date) => {
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(date));
    },

    // Show toast/notification messages
    showNotification: (message, type = 'info') => {
        // Implementation depends on your UI library/requirements
        console.log(`${type}: ${message}`);
    }
};

// Make utilities available globally
window.utils = utils;
