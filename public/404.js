// Minimal init script for the 404 page. Mirrors the header/footer logic of
// script.js, but omits the homepage-only pieces (server status grid, scroll
// spy, section animations) so it can't dereference elements that don't exist here.

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
    const storedTheme = localStorage.getItem('theme');
    applyTheme(storedTheme || getSystemTheme());

    // Listen to system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            applyTheme(e.matches ? 'dark' : 'light');
        }
    });

    // Toggle button event overrides system preference
    themeToggleBtn.addEventListener('click', () => {
        const isDark = htmlClassList.contains('dark');
        const newTheme = isDark ? 'light' : 'dark';

        localStorage.setItem('theme', newTheme);
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
            mobileMenuBtn.innerHTML = '<i data-lucide="x" class="w-5 h-5"></i>';
            lucide.createIcons();

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
            mobileMenuBtn.innerHTML = '<i data-lucide="menu" class="w-5 h-5"></i>';
            lucide.createIcons();
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

// Config Logic — populate footer social links
async function fetchConfig() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) {throw new Error('Failed to fetch config');}
        const config = await res.json();

        const setLink = (id, url) => {
            if (!url || url === '#') {return;}
            const el = document.getElementById(id);
            if (el) {el.href = url;}
            if (el && url !== '#') {el.target = '_blank';}
        };

        setLink('link-steam-footer', config.steamLink);
        setLink('link-twitch-footer', config.twitchLink);
        setLink('link-github-footer', config.githubLink);
    } catch (e) {
        console.error('Error fetching config:', e);
    }
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
            logoContainer.classList.remove('bg-blue-600', 'font-black');
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

// Main Initialization
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initMobileMenu();
    initCustomLogo();
    fetchConfig();
});

// Set current year in footer
document.getElementById('year').textContent = new Date().getFullYear();

// Initialize Lucide icons
if (typeof lucide !== 'undefined') {
    lucide.createIcons();
}
