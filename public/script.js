// Client-side HTML escape function (replaces server-side escape-html package)
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

const { animate, stagger, inView, scroll } = window.Motion;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Animate a number from 0 up to its target (easeOutCubic) via rAF.
function countUp(el, target, duration = 900) {
    if (!el) { return; }
    if (target <= 0) { el.textContent = '0'; return; }
    const start = performance.now();
    const step = (now) => {
        const progress = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = Math.round(eased * target);
        if (progress < 1) { requestAnimationFrame(step); }
    };
    requestAnimationFrame(step);
}

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
        
        // Update Discord widget theme
        if (window.__discordWidgetId) {
            updateDiscordWidget(window.__discordWidgetId);
        }
        
        // Button animation
        if (window.Motion && window.Motion.animate && !prefersReducedMotion) {
            window.Motion.animate(themeToggleBtn, { rotate: [0, 180] }, { duration: 0.3 });
        }
    });
}

async function fetchServerStatus() {
    const grid = document.getElementById('server-grid');
    
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        if (data.success && data.data) {
            grid.innerHTML = ''; // Specific clear removing skeletons
            
            data.data.forEach((server) => {
                const card = document.createElement('div');
                const maxPlayers = Number(server.maxplayers) || 0;
                const currentPlayers = Number(server.players) || 0;
                let playerPercentage = 0;
                if (maxPlayers > 0) {
                    playerPercentage = (currentPlayers / maxPlayers) * 100;
                }
                
                const serverName = escapeHTML(`${server.name}`);
                const serverIp = escapeHTML(`${server.host}:${server.port || 27015}`);
                const serverMap = escapeHTML(`${server.map || 'N/A'}`);
                
                card.className = "group bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 hover:border-brand-500/50 p-4 rounded-2xl transition-all cursor-pointer server-card card-hover opacity-0 translate-y-4 shadow-sm dark:shadow-none";

                const connectLink = `steam://connect/${server.host}:${server.port}`;
                card.onclick = () => window.location.href = connectLink;

                const onlineCount = server.status === 'online'
                    ? `<span class="player-count" data-target="${currentPlayers}">0</span>/${escapeHTML(server.maxplayers || '?')}`
                    : 'OFFLINE';

                card.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <h4 class="text-sm font-bold text-slate-900 dark:text-white tracking-tight">${serverName}</h4>
                            <p class="text-[10px] font-mono text-slate-500 mt-0.5">${serverIp}</p>
                        </div>
                        <div class="text-right">
                            <span class="text-sm font-bold ${server.status === 'online' ? 'text-brand-600 dark:text-brand-400' : 'text-red-500 dark:text-red-400'}">
                                ${onlineCount}
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 mt-4">
                        <div class="flex-1 h-1 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden relative">
                            <div class="absolute top-0 left-0 h-full ${server.status === 'online' ? 'bg-gradient-to-r from-brand-500 to-brand-300' : 'bg-red-500/50'} transition-all duration-1000 server-bar" data-bar-width="${Math.ceil(playerPercentage / 10) * 10}"></div>
                        </div>
                        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">${serverMap}</span>
                    </div>
                `;
                
                grid.appendChild(card);
            });
            
            // Apply CSS custom property for player bar widths (CSP-compliant)
            document.querySelectorAll('.server-bar').forEach(bar => {
                const width = bar.getAttribute('data-bar-width');
                if (width) {
                    bar.style.setProperty('--bar-width', width + '%');
                }
            });
            
            lucide.createIcons();
            
            // Animate Server Cards in with stagger
            if (!prefersReducedMotion) {
                animate(
                    ".server-card",
                    { opacity: [0, 1], y: [20, 0] },
                    { duration: 0.5, delay: stagger(0.1) }
                );
                // Count player numbers up from zero for a premium feel
                document.querySelectorAll('.player-count').forEach(el => {
                    countUp(el, Number(el.getAttribute('data-target')) || 0);
                });
            } else {
                // When reduced motion is preferred, make cards visible immediately
                document.querySelectorAll(".server-card").forEach(el => {
                    el.classList.remove('opacity-0', 'translate-y-4');
                });
                document.querySelectorAll('.player-count').forEach(el => {
                    el.textContent = el.getAttribute('data-target') || '0';
                });
            }

        }
    } catch (e) {
        console.error("Failed to fetch servers", e);
        grid.innerHTML = '<div class="col-span-full text-center text-red-500 py-8">Failed to contact server API. Please try again later.</div>';
    }
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

// Animations specific logic
function initAnimations() {
    // Nav bar: condense / solidify on scroll
    const nav = document.querySelector('nav');
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY > 50;
        nav.classList.toggle('shadow-md', scrolled);
        nav.classList.toggle('nav-scrolled', scrolled);
    }, { passive: true });

    // Hero reveal: headline words mask up, then subtitle + CTAs fade in
    const heroWords = document.querySelectorAll("#hero-title .reveal-word");
    const heroRest = document.querySelectorAll("#hero-content > p, #hero-content > div");
    heroRest.forEach(el => el.classList.remove('opacity-0'));
    if (!prefersReducedMotion) {
        animate(heroWords,
            { y: ['110%', '0%'] },
            { duration: 0.9, delay: stagger(0.12), ease: [0.22, 1, 0.36, 1] }
        );
        animate(heroRest,
            { opacity: [0, 1], y: [24, 0] },
            { duration: 0.7, delay: stagger(0.12, { startDelay: 0.35 }), ease: 'ease-out' }
        );
    } else {
        heroWords.forEach(el => { el.style.transform = 'none'; });
    }

    // Scroll-linked hero: gently drift + fade the glow and content as we leave
    if (scroll && !prefersReducedMotion) {
        const heroSection = document.getElementById('home');
        const heroGlow = document.getElementById('hero-glow');
        const heroContent = document.getElementById('hero-content');
        const scrollOpts = { target: heroSection, offset: ['start start', 'end start'] };
        if (heroGlow) {
            scroll(animate(heroGlow, { y: [0, 140], opacity: [1, 0.25] }, { ease: 'linear' }), scrollOpts);
        }
        if (heroContent) {
            scroll(animate(heroContent, { y: [0, 70], opacity: [1, 0] }, { ease: 'linear' }), scrollOpts);
        }
    }
    
    // About Section
    inView("#about-text", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        if (!prefersReducedMotion) {
            animate(el, { opacity: [0, 1], x: [-30, 0] }, { duration: 0.6 });
        }
    });
    
    inView("#about-features", () => {
        document.querySelectorAll("#about-features > div").forEach(el => el.classList.remove('opacity-0'));
        if (!prefersReducedMotion) {
            animate(
                "#about-features > div",
                { opacity: [0, 1], y: [20, 0] },
                { duration: 0.5, delay: stagger(0.15) }
            );
        }
    }, { amount: 0.2 });

    // Server list header
    inView("#servers-header", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        if (!prefersReducedMotion) {
            animate(el, { opacity: [0, 1], y: [20, 0] }, { duration: 0.5 });
        }
    });

    // Community section
    inView("#community-text", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        if (!prefersReducedMotion) {
            animate(el, { opacity: [0, 1], x: [-30, 0] }, { duration: 0.6 });
        }
    });

    inView("#discord-widget", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        if (!prefersReducedMotion) {
            animate(el, { opacity: [0, 1], scale: [0.95, 1] }, { duration: 0.6 });
        }
    });

    // Community Rules
    inView("#community-rules-grid", () => {
        document.querySelectorAll("#community-rules-grid .rule-card").forEach(el => el.classList.remove('opacity-0'));
        if (!prefersReducedMotion) {
            animate(
                "#community-rules-grid .rule-card",
                { opacity: [0, 1], y: [20, 0] },
                { duration: 0.4, delay: stagger(0.08) }
            );
        }
    }, { amount: 0.1 });

    // Timer Rules
    inView("#timer-rules-grid", () => {
        document.querySelectorAll("#timer-rules-grid .rule-card").forEach(el => el.classList.remove('opacity-0'));
        if (!prefersReducedMotion) {
            animate(
                "#timer-rules-grid .rule-card",
                { opacity: [0, 1], y: [20, 0] },
                { duration: 0.4, delay: stagger(0.08) }
            );
        }
    }, { amount: 0.1 });

    // Resources section
    inView("#resources-header", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        if (!prefersReducedMotion) {
            animate(el, { opacity: [0, 1], y: [20, 0] }, { duration: 0.5 });
        }
    });
    
    inView("#resources-grid", () => {
        document.querySelectorAll("#resources-grid > a").forEach(el => el.classList.remove('opacity-0'));
        if (!prefersReducedMotion) {
            animate(
                "#resources-grid > a",
                { opacity: [0, 1], y: [20, 0] },
                { duration: 0.5, delay: stagger(0.15) }
            );
        }
    }, { amount: 0.2 });

    // Rule-card hover lift/glow is handled in CSS (.rule-card:hover) for
    // performance and to respect prefers-reduced-motion without JS.
}

// Config Logic
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

        setLink('link-steam-community', config.steamLink);
        setLink('link-twitch-community', config.twitchLink);
        setLink('link-github-community', config.githubLink);

        setLink('link-steam-footer', config.steamLink);
        setLink('link-twitch-footer', config.twitchLink);
        setLink('link-github-footer', config.githubLink);

        const iframe = document.getElementById('discord-iframe');
        if (iframe && config.discordWidgetId) {
            window.__discordWidgetId = config.discordWidgetId;
            updateDiscordWidget(config.discordWidgetId);
        }
    } catch (e) {
        console.error('Error fetching config:', e);
    }
}

// Update Discord widget iframe with current theme
function updateDiscordWidget(widgetId) {
    const iframe = document.getElementById('discord-iframe');
    if (iframe && widgetId) {
        const isDark = document.documentElement.classList.contains('dark');
        iframe.src = `https://discord.com/widget?id=${widgetId}&theme=${isDark ? 'dark' : 'light'}`;
    }
}

// URL Hash Updates
function initScrollSpy() {
    const sections = document.querySelectorAll('header[id], section[id]');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const id = entry.target.getAttribute('id');
                const hash = id === 'home' ? window.location.pathname + window.location.search : `#${id}`;
                window.history.replaceState(null, null, hash);
            }
        });
    }, {
        rootMargin: '-20% 0px -79% 0px'
    });

    sections.forEach((section) => observer.observe(section));
}

// Main Initialization
document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initMobileMenu();
    initAnimations();
    initScrollSpy();
    initCustomLogo();
    fetchServerStatus();
    fetchConfig();
});

// Set current year in footer
document.getElementById('year').textContent = new Date().getFullYear();

// Initialize Lucide icons
if (typeof lucide !== 'undefined') {
    lucide.createIcons();
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
