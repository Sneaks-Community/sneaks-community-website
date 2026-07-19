// Loads first (head, no defer) so the safeStorage helper is available to common.js.
window.safeStorage = {
    get(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch { /* storage blocked (privacy mode) */ }
    },
};

(function () {
    const stored = window.safeStorage.get('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (stored ? stored === 'dark' : prefersDark) {
        document.documentElement.classList.add('dark');
    }
}());
