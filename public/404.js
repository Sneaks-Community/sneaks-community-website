// 404-page-specific logic: populate the footer social links. Shared logic (theme,
// mobile menu, custom logo, icons) lives in common.js, which loads before this file.

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

// Main Initialization (404-specific; shared init runs from common.js)
document.addEventListener("DOMContentLoaded", () => {
    fetchConfig();
});
