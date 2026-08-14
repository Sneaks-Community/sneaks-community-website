// Shared logic used by every page (homepage + 404): theme, mobile menu, custom logo,
// icons. Loaded before each page's own script. Page-specific behaviour (server grid,
// scroll animations, config link sets) lives in script.js.

// Theme Initialization and Logic
function initTheme() {
    const htmlClassList = document.documentElement.classList;
    const themeToggleBtn = document.getElementById('themeToggle');

    const getSystemTheme = () => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

    const applyTheme = (theme) => {
        if (theme === 'dark') {
            htmlClassList.add('dark');
        } else {
            htmlClassList.remove('dark');
        }
    };

    // Initialize based on saved preference or system default
    const storedTheme = window.safeStorage.get('theme');
    applyTheme(storedTheme || getSystemTheme());

    // Listen to system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!window.safeStorage.get('theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });

    if (!themeToggleBtn) { return; }

    // Toggle button event overrides system preference
    themeToggleBtn.addEventListener('click', () => {
        const isDark = htmlClassList.contains('dark');
        const newTheme = isDark ? 'light' : 'dark';

        const commit = () => {
            window.safeStorage.set('theme', newTheme);
            applyTheme(newTheme);
        };

        // Animate (rotate) theme toggle
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion || !document.startViewTransition) {
            commit();
        } else {
            const rect = themeToggleBtn.getBoundingClientRect();
            const root = document.documentElement;
            root.style.setProperty('--vt-x', `${rect.left + rect.width / 2}px`);
            root.style.setProperty('--vt-y', `${rect.top + rect.height / 2}px`);
            document.startViewTransition(commit);
        }

        // Restart the CSS spin by clearing the class before re-adding it.
        themeToggleBtn.classList.remove('is-spinning');
        void themeToggleBtn.offsetWidth;
        themeToggleBtn.classList.add('is-spinning');
    });

    themeToggleBtn.addEventListener('animationend', () => {
        themeToggleBtn.classList.remove('is-spinning');
    });
}

// Mobile Menu Logic
function initMobileMenu() {
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileMenu = document.getElementById('mobileMenu');
    const mobileLinks = document.querySelectorAll('.mobile-link');

    // Safety check just in case elements are missing
    if (!mobileMenuBtn || !mobileMenu) {return;}

    let isMenuOpen = false;

    const toggleMenu = () => {
        isMenuOpen = !isMenuOpen;

        if (isMenuOpen) {
            mobileMenu.classList.remove('opacity-0', 'pointer-events-none');
            mobileMenu.classList.add('is-open'); // Drives the CSS link stagger
            document.body.classList.add('overflow-hidden'); // Prevent scrolling
            mobileMenuBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" class="w-5 h-5"><use href="#icon-x"/></svg>';
        } else {
            mobileMenu.classList.remove('is-open');
            mobileMenu.classList.add('opacity-0', 'pointer-events-none');
            document.body.classList.remove('overflow-hidden'); // Restore scrolling
            mobileMenuBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" class="w-5 h-5"><use href="#icon-menu"/></svg>';
        }
    };

    mobileMenuBtn.addEventListener('click', toggleMenu);

    // Close when a link inside is clicked
    mobileLinks.forEach(link => {
        link.addEventListener('click', () => {
            if (isMenuOpen) {toggleMenu();}
        });
    });
}

// Shared init shared by every page. Page-specific init runs from each page's own script.
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initMobileMenu();
});

// Set current year in footer
document.getElementById('year').textContent = new Date().getFullYear();
