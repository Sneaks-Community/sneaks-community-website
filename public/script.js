// Client-side HTML escape function (replaces server-side escape-html package)
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

const { animate, stagger, inView } = window.Motion;

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
        if (window.Motion && window.Motion.animate) {
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
                
                const serverName = escapeHTML(`${server.name}`.toUpperCase());
                const serverIp = escapeHTML(`${server.host}:${server.port || 27015}`);
                const serverMap = escapeHTML(`${server.map || 'N/A'}`);
                
                card.className = "group bg-white dark:bg-black/40 border border-slate-200 dark:border-white/5 hover:border-blue-500/50 p-4 rounded-xl transition-all cursor-pointer server-card opacity-0 translate-y-4 shadow-sm dark:shadow-none";
                
                const connectLink = `steam://connect/${server.host}:${server.port}`;
                card.onclick = () => window.location.href = connectLink;

                card.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <div>
                            <h4 class="text-sm font-bold text-slate-900 dark:text-white tracking-tight">${serverName}</h4>
                            <p class="text-[10px] font-mono text-slate-500 mt-0.5">${serverIp}</p>
                        </div>
                        <div class="text-right">
                            <span class="text-sm font-bold ${server.status === 'online' ? 'text-blue-600 dark:text-blue-400' : 'text-red-500 dark:text-red-400'}">
                                ${server.status === 'online' ? escapeHTML(server.players) + '/' + escapeHTML(server.maxplayers || '?') : 'OFFLINE'}
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 mt-4">
                        <div class="flex-1 h-1 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden relative">
                            <div class="absolute top-0 left-0 h-full ${server.status === 'online' ? 'bg-blue-500' : 'bg-red-500/50'} transition-all duration-1000 server-bar" data-bar-width="${Math.ceil(playerPercentage / 10) * 10}"></div>
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
            animate(
                ".server-card", 
                { opacity: [0, 1], y: [20, 0] },
                { duration: 0.5, delay: stagger(0.1) }
            );

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
            if (window.Motion && window.Motion.animate && window.Motion.stagger) {
                window.Motion.animate(
                    mobileLinks,
                    { opacity: [0, 1], y: [20, 0] },
                    { duration: 0.4, delay: window.Motion.stagger(0.1) }
                );
            }
        } else {
            mobileMenu.classList.remove('opacity-0', 'pointer-events-none');
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
    // Nav bar shadow appear on scroll
    const nav = document.querySelector('nav');
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            nav.classList.add('shadow-md');
        } else {
            nav.classList.remove('shadow-md');
        }
    });

    // Hero Section Reveal
    document.querySelectorAll("#hero-content > *").forEach(el => el.classList.remove('opacity-0'));
    animate("#hero-content > *", 
        { opacity: [0, 1], y: [40, 0], scale: [0.95, 1] }, 
        { duration: 0.8, delay: stagger(0.15), easing: "ease-out" }
    );
    
    // About Section
    inView("#about-text", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        animate(el, { opacity: [0, 1], x: [-30, 0] }, { duration: 0.6 });
    });

    inView("#about-features", () => {
        document.querySelectorAll("#about-features > div").forEach(el => el.classList.remove('opacity-0'));
        animate(
            "#about-features > div", 
            { opacity: [0, 1], y: [20, 0] }, 
            { duration: 0.5, delay: stagger(0.15) }
        );
    }, { amount: 0.2 });

    // Server list header
    inView("#servers-header", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        animate(el, { opacity: [0, 1], y: [20, 0] }, { duration: 0.5 });
    });

    // Community section
    inView("#community-text", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        animate(el, { opacity: [0, 1], x: [-30, 0] }, { duration: 0.6 });
    });

    inView("#discord-widget", (info) => {
        const el = info.target || info;
        if(el && el.classList) {el.classList.remove('opacity-0');}
        animate(el, { opacity: [0, 1], scale: [0.95, 1] }, { duration: 0.6 });
    });

    // Rules
    inView("#rules-grid", () => {
        document.querySelectorAll("#rules-grid > div").forEach(el => el.classList.remove('opacity-0'));
        animate(
            "#rules-grid > div", 
            { opacity: [0, 1], y: [30, 0] }, 
            { duration: 0.5, delay: stagger(0.1) }
        );
    }, { amount: 0.2 });
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
    fetchServerStatus();
    fetchConfig();
});

// Set current year in footer
document.getElementById('year').textContent = new Date().getFullYear();

// Initialize Lucide icons
if (typeof lucide !== 'undefined') {
    lucide.createIcons();
}
