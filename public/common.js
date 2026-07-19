// Shared logic used by every page (homepage + 404): theme, mobile menu, custom logo,
// icons. Loaded before each page's own script. Page-specific behaviour (server grid,
// scroll animations, config link sets) lives in script.js / 404.js.

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

        window.safeStorage.set('theme', newTheme);
        applyTheme(newTheme);

        // Button animation
        if (window.Motion && window.Motion.animate && !prefersReducedMotion) {
            window.Motion.animate(themeToggleBtn, { rotate: [0, 180] }, { duration: 0.3 });
        }
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
            document.body.classList.add('overflow-hidden'); // Prevent scrolling
            mobileMenuBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" class="w-5 h-5"><use href="#icon-x"/></svg>';

            // Animate links in
            if (window.Motion && window.Motion.animate && window.Motion.stagger && !prefersReducedMotion) {
                window.Motion.animate(
                    mobileLinks,
                    { opacity: [0, 1], y: [20, 0] },
                    { duration: 0.4, delay: window.Motion.stagger(0.1) }
                );
            }
        } else {
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

async function checkLogoExists(url) {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.ok;
    } catch {
        return false;
    }
}

async function initCustomLogo() {
    const logoContainer = document.getElementById('logoContainer');
    const crosshairIcon = document.getElementById('crosshairIcon');

    if (!logoContainer || !crosshairIcon) { return; }

    // Try to load custom logo from user-assets
    const logoPaths = ['/logo.svg', '/logo.webp', '/logo.png'];

    for (const logoPath of logoPaths) {
        if (await checkLogoExists(logoPath)) {
            // Logo found, swap it in
            logoContainer.classList.remove('bg-brand-500', 'font-black');
            logoContainer.classList.add('has-logo');
            logoContainer.innerHTML = '';

            const logoImg = document.createElement('img');
            logoImg.src = logoPath;
            logoImg.alt = 'Logo';
            logoContainer.appendChild(logoImg);
            return;
        }
    }
}

// Shared init shared by every page. Page-specific init runs from each page's own script.
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initMobileMenu();
    initCustomLogo();
});

// Set current year in footer
document.getElementById('year').textContent = new Date().getFullYear();
