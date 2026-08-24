// Homepage-specific logic: server status grid, scroll animations, config link set,
// scroll spy. Shared logic (theme, mobile menu, custom logo, icons) lives in common.js,
// which loads before this file.

// Client-side HTML escape function (replaces server-side escape-html package)
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Motion is a progressive enhancement loaded from /lib/motion.js. If it fails to load,
// window.Motion is undefined — so read it defensively. Destructuring it directly would
// throw here at module scope and take down every feature on the page (theme, menu, etc.).
const Motion = window.Motion ?? {};
const { animate, stagger } = Motion;
const motionReady = typeof animate === 'function';
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Treat a missing animation library like reduced-motion: reveal content statically,
// skip animation.
const animationsOff = prefersReducedMotion || !motionReady;

async function fetchServerStatus() {
    const grid = document.getElementById('server-grid');
    grid.setAttribute('aria-busy', 'true');

    try {
        const res = await fetch('/api/status');
        const data = await res.json().catch(() => null);

        if (!res.ok || !data || !data.success || !data.data) {
            throw new Error(`API responded ${res.status}`);
        }

        {
            grid.innerHTML = ''; // Specific clear removing skeletons

            data.data.forEach((server) => {
                // The card holds two controls (connect, copy address), so the steam:// link is a
                // stretched overlay anchor rather than the card element itself: a <button> nested
                // inside an <a> is invalid and announces badly.
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

                const stateClass = server.status === 'online' ? 'server-card--online' : 'server-card--offline';
                card.className = `group relative surface-card card-hover p-4 rounded-2xl server-card ${stateClass} opacity-0 translate-y-2`;

                const onlineCount = server.status === 'online'
                    ? `<span class="player-count" data-target="${currentPlayers}">0</span>/${escapeHTML(server.maxplayers || '?')}`
                    : 'OFFLINE';

                card.innerHTML = `
                    <a class="connect-link absolute inset-0 z-0 rounded-2xl cursor-pointer"></a>
                    <div class="flex justify-between items-start gap-2 mb-2">
                        <div class="min-w-0 break-words">
                            <h4 class="text-sm font-bold text-slate-900 dark:text-white tracking-tight">${serverName}</h4>
                            <p class="flex items-center gap-1.5 text-[10px] font-mono text-slate-500 mt-0.5">
                                ${serverIp}
                                <button type="button" class="copy-ip relative z-10 p-1 -m-1 rounded text-slate-400 hover:text-brand-600 dark:hover:text-brand-400 transition-colors" aria-label="Copy server address">
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" class="w-3 h-3"><use href="#icon-copy"/></svg>
                                </button>
                            </p>
                        </div>
                        <div class="text-right shrink-0">
                            <span class="text-sm font-bold ${server.status === 'online' ? 'text-brand-600 dark:text-brand-400' : 'text-red-500 dark:text-red-400'}">
                                ${onlineCount}
                            </span>
                        </div>
                    </div>
                    <div class="flex items-center gap-3 mt-4">
                        <div class="flex-1 h-1.5 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden relative">
                            <div class="absolute top-0 left-0 h-full rounded-full ${server.status === 'online' ? 'bg-gradient-to-r from-live-500 to-live-300' : 'bg-red-500/50'} transition-all duration-1000 server-bar" data-bar-width="${Math.ceil(playerPercentage / 10) * 10}"></div>
                        </div>
                        <span class="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right whitespace-nowrap">${serverMap}</span>
                    </div>
                `;

                // Set from the raw values so a quote in a host or name can't break out of the
                // attribute (escapeHTML leaves quotes alone).
                const link = card.querySelector('.connect-link');
                link.href = `steam://connect/${server.host}:${server.port}`;
                link.setAttribute('aria-label', `Connect to ${server.name}`);
                card.querySelector('.copy-ip').dataset.ip = `${server.host}:${server.port || 27015}`;

                grid.appendChild(card);
            });

            // Apply CSS custom property for player bar widths (CSP-compliant)
            document.querySelectorAll('.server-bar').forEach(bar => {
                const width = bar.getAttribute('data-bar-width');
                if (width) {
                    bar.style.setProperty('--bar-width', width + '%');
                }
            });

            // Animate Server Cards in with stagger
            if (!animationsOff) {
                animate(
                    ".server-card",
                    { opacity: [0, 1], y: [10, 0] },
                    { duration: 0.5, delay: stagger(0.1) }
                );
                // Count player numbers up from zero for a premium feel
                document.querySelectorAll('.player-count').forEach(el => {
                    const target = Number(el.getAttribute('data-target')) || 0;
                    if (target <= 0) { el.textContent = '0'; return; }
                    animate(0, target, {
                        duration: 0.9,
                        ease: [0.33, 1, 0.68, 1],
                        onUpdate: (v) => { el.textContent = Math.round(v); },
                    });
                });
            } else {
                // When reduced motion is preferred, make cards visible immediately
                document.querySelectorAll(".server-card").forEach(el => {
                    el.classList.remove('opacity-0', 'translate-y-2');
                });
                document.querySelectorAll('.player-count').forEach(el => {
                    el.textContent = el.getAttribute('data-target') || '0';
                });
            }

        }
    } catch (e) {
        console.error("Failed to fetch servers", e);
        grid.innerHTML = `
            <div role="status" class="col-span-full surface-card rounded-2xl p-8 flex flex-col items-center text-center gap-3">
                <div class="w-11 h-11 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" class="w-6 h-6"><use href="#icon-flag"/></svg>
                </div>
                <p class="text-sm font-bold text-slate-900 dark:text-white">Server status unavailable</p>
                <p class="text-xs text-slate-600 dark:text-slate-400">Failed to contact server API. Please try again later.</p>
            </div>`;
    } finally {
        grid.setAttribute('aria-busy', 'false');
    }
}

// navigator.clipboard is only available in a secure context, and self-hosted
// instances commonly run over plain http, so keep the legacy fallback.
async function copyText(text) {
    if (navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch { /* fall through to execCommand */ }
    }

    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.className = 'sr-only';
    document.body.appendChild(field);
    field.select();
    let copied;
    try {
        copied = document.execCommand('copy');
    } catch {
        copied = false;
    }
    field.remove();
    return copied;
}

// Copy button on each server card. Delegated from the grid because the cards are
// rendered after this runs. The clipboard gets the bare host:port, not the
// steam:// URL the card links to.
function initCopyIp() {
    const grid = document.getElementById('server-grid');
    const status = document.getElementById('copy-status');
    let resetTimer;

    grid.addEventListener('click', async (event) => {
        const button = event.target.closest('.copy-ip');
        if (!button) { return; }

        const ip = button.dataset.ip;
        const copied = await copyText(ip);
        const icon = button.querySelector('use');

        icon.setAttribute('href', copied ? '#icon-check' : '#icon-copy');
        button.classList.toggle('text-live-500', copied);
        status.textContent = copied ? `Copied ${ip}` : 'Copy failed';

        clearTimeout(resetTimer);
        resetTimer = setTimeout(() => {
            icon.setAttribute('href', '#icon-copy');
            button.classList.remove('text-live-500');
            status.textContent = '';
        }, 1500);
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
    if (!animationsOff) {
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

    // Rule-card hover lift/glow is handled in CSS (.rule-card:hover) for
    // performance and to respect prefers-reduced-motion without JS.
}

// Keep the aurora sweep off the compositor while it is scrolled out of view.
function initAurora() {
    const aurora = document.querySelector('.aurora');
    if (!aurora || prefersReducedMotion) { return; }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            aurora.classList.toggle('is-visible', entry.isIntersecting);
        });
    }, { rootMargin: '15% 0px' });

    observer.observe(aurora);
}

// URL hash updates + the matching nav link's underline. aria-current doubles as
// the style hook, so screen readers announce the current section for free.
function initScrollSpy() {
    const sections = document.querySelectorAll('header[id], section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                const id = entry.target.getAttribute('id');
                const hash = id === 'home' ? window.location.pathname + window.location.search : `#${id}`;
                window.history.replaceState(null, null, hash);

                navLinks.forEach((link) => {
                    if (link.getAttribute('href') === `#${id}`) {
                        link.setAttribute('aria-current', 'location');
                    } else {
                        link.removeAttribute('aria-current');
                    }
                });
            }
        });
    }, {
        rootMargin: '-20% 0px -79% 0px'
    });

    sections.forEach((section) => observer.observe(section));
}

// Main Initialization (homepage-specific; shared init runs from common.js)
document.addEventListener("DOMContentLoaded", () => {
    initAnimations();
    initScrollSpy();
    initAurora();
    initCopyIp();
    fetchServerStatus();
});
