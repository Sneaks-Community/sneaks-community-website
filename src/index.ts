import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { GameDig } from 'gamedig';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { logger } from './logger.js';

// Global error handlers to prevent unhandled rejections from crashing silently
process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled rejection');
});

process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception');
    process.exit(1);
});

// Handling __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Server config interface for type safety
interface ServerConfig {
    id: string;
    host: string;
    port: number;
    type: string;
    name?: string;
}

interface AppConfig {
    servers: ServerConfig[];
}

// Read and validate configuration; CONFIG_PATH overrides the default location.
const configPathOverride = (process.env.CONFIG_PATH ?? '').trim();
const configPath = configPathOverride
    ? path.resolve(configPathOverride)
    : path.join(__dirname, '..', 'config', 'config.json');
let config: AppConfig;

try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- operator-supplied path
    const rawConfig = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(rawConfig) as AppConfig;
    logger.info({ serverCount: config.servers.length, configPath }, 'Configuration loaded successfully');
} catch (error) {
    logger.fatal({ err: error }, 'Failed to load configuration');
    process.exit(1);
}

if (!Array.isArray(config.servers) || config.servers.length === 0) {
    logger.fatal('Invalid configuration: "servers" array is required and must not be empty');
    process.exit(1);
}

// Community branding used to render the page title, headings, SEO metadata, links and a
// few identity-specific prose fields. All are configured via environment variables (with
// fallbacks to the current defaults) and injected into the HTML templates at startup, so a
// precompiled image only needs an env change + restart — no rebuild. See renderBranding().
const communityName = (process.env.COMMUNITY_NAME ?? '').trim() || "Sneak's Community";
const communityEstablished = Number(process.env.COMMUNITY_ESTABLISHED) || 2015;
// Discord invite URL used by the "JOIN DISCORD" CTAs and the community Join card.
// Set DISCORD_LINK to your server's invite (e.g. https://discord.gg/yourinvite).
const discordLink = (process.env.DISCORD_LINK ?? '').trim() || "https://discord.gg/snksrv";

// External social/community links, injected directly into the server-rendered anchors so
// every visitor (including no-JS) gets correct links without any client-side API call.
const steamLink = (process.env.STEAM_LINK ?? '').trim() || 'https://steamcommunity.com/groups/sneakscommunity';
const twitchLink = (process.env.TWITCH_LINK ?? '').trim() || 'https://twitch.tv/snksrv';
const githubLink = (process.env.GITHUB_LINK ?? '').trim() || 'https://github.com/Sneaks-Community';

// Resource-card destinations (Player Statistics / Ban List).
const statsLink = (process.env.STATS_LINK ?? '').trim() || 'https://stats.snksrv.com';
const bansLink = (process.env.BANS_LINK ?? '').trim() || 'https://bans.snksrv.com';

// Canonical site origin, injected raw into sitemap.xml/robots.txt and composed as
// `{{siteUrl}}/...` in the templates, so it must be a clean http(s) origin (no path, query,
// or hash). Parse with URL and fall back to the default with a loud warning if it isn't.
const DEFAULT_SITE_URL = 'https://snksrv.com';
function resolveSiteUrl(raw: string | undefined): string {
    const value = (raw ?? '').trim();
    if (value === '') return DEFAULT_SITE_URL;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol must be http(s)');
        if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) throw new Error('must be a bare origin');
        return url.origin;
    } catch (error) {
        logger.warn({ err: error, siteUrl: value }, `Invalid SITE_URL, falling back to ${DEFAULT_SITE_URL}`);
        return DEFAULT_SITE_URL;
    }
}
const siteUrl = resolveSiteUrl(process.env.SITE_URL);

// SEO metadata and a few identity-specific prose fields.
const metaDescription = (process.env.META_DESCRIPTION ?? '').trim()
    || "Sneak's Community - An open and fun gaming community for all. Join our CS:GO servers for Surf, KZ Climb, Bhop, 1v1 Arenas, and more. No application. No membership. Just fun and friends.";
const metaKeywords = (process.env.META_KEYWORDS ?? '').trim()
    || 'sneak community, gaming, cs2, csgo, surf, kz climb, bhop, 1v1 arenas, retakes, counter-strike, discord, gaming community';
const heroTagline = (process.env.HERO_TAGLINE ?? '').trim()
    || 'An open and fun gaming community for all. No application. No membership. Just fun and friends.';
const aboutParagraph1 = (process.env.ABOUT_PARAGRAPH_1 ?? '').trim()
    || "Founded in 2015, Sneak's Community started as a single CS:GO Minigames server. Over the years, our community evolved and has grown through many games, and we found our true home hosting Counter-Strike: Global Offensive servers, while providing a welcoming environment for all games.";
const aboutParagraph2 = (process.env.ABOUT_PARAGRAPH_2 ?? '').trim()
    || "Whether you're grinding Surf, mastering your aim in 1v1 Arenas, or just hanging out in the Chill Zone, this is your community.";

// Structured data (JSON-LD) for search engines: Organization + WebSite. Built from the same
// branding values as the meta tags and serialized here rather than templated into the HTML —
// renderBranding() HTML-escapes its values ('"' -> '&quot;'), which is invalid inside a
// <script type="application/ld+json"> block (parsed as JSON, not HTML). JSON.stringify already
// produces JSON-safe strings; we additionally escape '<' so a value can't break out of the
// </script> element. Injected raw via the {{structuredData}} token in renderBranding().
const structuredData = JSON.stringify([
    {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: communityName,
        url: `${siteUrl}/`,
        logo: `${siteUrl}/og-image.png`,
        description: metaDescription,
        sameAs: [discordLink, steamLink, twitchLink, githubLink],
    },
    {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: communityName,
        url: `${siteUrl}/`,
    },
]).replaceAll('<', '\\u003c');

// Validate each server entry: required non-empty strings, a port in the valid range, and
// unique ids across the config (values come from JSON, so types are checked at runtime).
const seenServerIds = new Set<string>();
for (const server of config.servers) {
    const label = server.id || 'unknown';
    const fail = (reason: string): never => {
        logger.fatal({ serverId: label }, `Invalid server config for "${label}": ${reason}`);
        process.exit(1);
    };

    if (typeof server.id !== 'string' || !server.id.trim()) fail('id must be a non-empty string');
    if (typeof server.host !== 'string' || !server.host.trim()) fail('host must be a non-empty string');
    if (typeof server.type !== 'string' || !server.type.trim()) fail('type must be a non-empty string');
    if (!Number.isInteger(server.port) || server.port < 1 || server.port > 65535) fail('port must be an integer between 1 and 65535');
    if (seenServerIds.has(server.id)) fail('duplicate id');
    seenServerIds.add(server.id);
}

// Pre-render index.html with community branding. The values are fixed for the process
// lifetime (the container is restarted to pick up env changes), so render once at startup.
const escapeHtml = (value: string): string =>
    value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

// Detect a user-supplied logo at startup (user-assets/logo.{svg,webp,png}, in priority order)
const userAssetsPath = path.join(__dirname, '..', 'user-assets');
const detectLogoPath = (): string | null => {
    // Checked with literal filenames (not a loop variable) so the analyzer can fold the path,
    // matching the trusted-constant fs access already used for the user-assets mount below.
    if (fs.existsSync(path.join(userAssetsPath, 'logo.svg'))) return '/logo.svg';
    if (fs.existsSync(path.join(userAssetsPath, 'logo.webp'))) return '/logo.webp';
    if (fs.existsSync(path.join(userAssetsPath, 'logo.png'))) return '/logo.png';
    return null;
};
const logoPath = detectLogoPath();
if (logoPath) logger.info({ logoPath }, 'Custom logo detected in user-assets');

// Content-hashed asset URLs: the hash names one exact build of the file, so the response can be
// served immutable for a year (see setStaticCacheHeaders) and a deploy re-fetches only what changed.
const assetUrl = (relativePath: string): string => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed call sites below
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'public', relativePath));
    const hash = crypto.createHash('sha256').update(bytes).digest('base64url').slice(0, 10);
    return `/${relativePath}?v=${hash}`;
};

// Token values, already fully escaped (or JSON-safe for structuredData). Substituted via a
// single function-replacer pass so replaceAll's '$' patterns ($$, $&, ...) in values can't
// mangle the output or re-inject the matched token.
const brandingTokens = new Map<string, string>([
    ['communityName', escapeHtml(communityName)],
    ['established', String(communityEstablished)],
    ['discordLink', escapeHtml(discordLink)],
    ['siteUrl', escapeHtml(siteUrl)],
    ['metaDescription', escapeHtml(metaDescription)],
    ['metaKeywords', escapeHtml(metaKeywords)],
    ['steamLink', escapeHtml(steamLink)],
    ['twitchLink', escapeHtml(twitchLink)],
    ['githubLink', escapeHtml(githubLink)],
    ['statsLink', escapeHtml(statsLink)],
    ['bansLink', escapeHtml(bansLink)],
    ['heroTagline', escapeHtml(heroTagline)],
    ['aboutParagraph1', escapeHtml(aboutParagraph1)],
    ['aboutParagraph2', escapeHtml(aboutParagraph2)],
    ['structuredData', structuredData],
    // Hashes are base64url over fixed filenames, so there is nothing to escape.
    ['themeInitJs', assetUrl('theme-init.js')],
    ['tailwindCss', assetUrl('tailwind.css')],
    ['motionJs', assetUrl('lib/motion.js')],
    ['commonJs', assetUrl('common.js')],
    ['scriptJs', assetUrl('script.js')],
    // One skeleton per configured server, so the grid is already its final height when the
    // browser resolves a #fragment: late-growing content above an anchor lands you short of it.
    ['serverSkeletons', '<div class="surface-card rounded-2xl p-4 animate-pulse w-full h-[88px]"></div>'.repeat(config.servers.length)],
    // Logo tokens are trusted HTML markup (not user text), so they are injected raw. logoPath is
    // one of three fixed internal filenames, so there is nothing to escape.
    ['logoContainerClass', logoPath ? 'has-logo' : 'bg-brand-500 font-black'],
    ['logoContainerInner', logoPath
        ? `<img src="${logoPath}" alt="Logo">`
        : '<svg id="crosshairIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" class="w-5 h-5"><use href="/icons.svg#icon-crosshair"/></svg>'],
]);

const renderBranding = (html: string): string =>
    html.replace(/\{\{(\w+)\}\}/g, (match, token: string) =>
        brandingTokens.get(token) ?? match
    );

const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
const notFoundHtmlPath = path.join(__dirname, '..', 'public', '404.html');
// robots.txt and sitemap.xml are plain-text/XML, not HTML, so the site origin is injected
// raw (a bare origin has no HTML-special chars, and HTML-escaping '&' would corrupt them).
const robotsTxtPath = path.join(__dirname, '..', 'public', 'robots.txt');
const sitemapXmlPath = path.join(__dirname, '..', 'public', 'sitemap.xml');
// Icons are authored one per file in public/icons/ and concatenated into a single sprite at
// startup: one cacheable request for every page instead of an inline copy per page. Each file is a
// standalone renderable SVG, so its root <svg> becomes the <symbol> and the id comes from the
// filename (public/icons/sun.svg -> #icon-sun).
const iconsDirectory = path.join(__dirname, '..', 'public', 'icons');
const buildIconSprite = (): string => {
    const symbols = fs.readdirSync(iconsDirectory)
        .filter((file) => file.endsWith('.svg'))
        .sort()
        .map((file) => {
            // eslint-disable-next-line security/detect-non-literal-fs-filename -- name comes from readdirSync over a fixed directory
            const svg = fs.readFileSync(path.join(iconsDirectory, file), 'utf-8');
            const root = /<svg\b([^>]*)>/.exec(svg);
            if (!root) {
                throw new Error(`icons/${file}: no <svg> root element`);
            }
            // Keep presentation attributes (viewBox, fill, stroke...); drop the ones a <symbol>
            // must not carry over from the standalone document.
            const attributes = root[1].replace(/\s(?:xmlns|id|class|width|height)="[^"]*"/g, '');
            const body = svg.slice(root.index + root[0].length, svg.lastIndexOf('</svg>'));
            return `<symbol id="icon-${path.basename(file, '.svg')}"${attributes}>${body}</symbol>`;
        });
    if (symbols.length === 0) {
        throw new Error('icons/: no .svg files found');
    }
    return `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>`;
};

let iconSprite: string;
let renderedIndexHtml: string;
let rendered404Html: string;
let renderedRobotsTxt: string;
let renderedSitemapXml: string;
try {
    iconSprite = buildIconSprite();
    renderedIndexHtml = renderBranding(fs.readFileSync(indexHtmlPath, 'utf-8'));
    rendered404Html = renderBranding(fs.readFileSync(notFoundHtmlPath, 'utf-8'));
    renderedRobotsTxt = fs.readFileSync(robotsTxtPath, 'utf-8').replaceAll('{{siteUrl}}', () => siteUrl);
    renderedSitemapXml = fs.readFileSync(sitemapXmlPath, 'utf-8').replaceAll('{{siteUrl}}', () => siteUrl);
} catch (error) {
    logger.fatal({ err: error }, 'Failed to read HTML template or icon sprite');
    process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Header naming where the real client IP arrives: CF-Connecting-IP behind Cloudflare, X-Real-IP or
// X-Forwarded-For behind a reverse proxy. Trusting it rests on the upstream that sets it being the
// only route to this app, which is the operator's call. Unset means the socket peer is used and no
// header can override it.
function resolveClientIpHeader(raw: string | undefined): string | null {
    const name = (raw ?? '').trim().toLowerCase();
    if (name === '') return null;
    if (!/^[\d!#$%&'*+.^_`|~a-z-]+$/.test(name)) {
        logger.warn({ header: name }, 'CLIENT_IP_HEADER is not a valid header name, ignoring it');
        return null;
    }
    return name;
}
const CLIENT_IP_HEADER = resolveClientIpHeader(process.env.CLIENT_IP_HEADER);
if (CLIENT_IP_HEADER) logger.info({ header: CLIENT_IP_HEADER }, 'Trusting client IP header');

// Single source of truth for the client IP used by the rate limiter. A
// forwarding chain is only trustworthy from the right: whatever precedes the last entry was supplied
// by the client, so read the last one and ignore the rest. Single-value headers are unaffected.
function getClientIp(req: express.Request): string | undefined {
    if (!CLIENT_IP_HEADER) return req.socket.remoteAddress;
    // eslint-disable-next-line security/detect-object-injection -- charset-validated header name
    const forwarded = (req.headers[CLIENT_IP_HEADER] ?? '').toString();
    const nearest = forwarded.slice(forwarded.lastIndexOf(',') + 1).trim();
    return net.isIP(nearest) ? nearest : req.socket.remoteAddress;
}

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            fontSrc: ["'self'"],
            imgSrc: ["'self'"],
            frameSrc: ["'none'"],
            frameAncestors: ["'none'"],
            connectSrc: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    },
}));

app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

// Restrict CORS to allowed origins instead of allowing all. /api only; a global mount would put
// `Vary: Origin` on every asset.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) ?? ['http://localhost:3000'];
app.use('/api', cors({
    origin: allowedOrigins,
    methods: ['GET'],
    allowedHeaders: ['Content-Type'],
}));

// Enable gzip compression for all responses
app.use(compression());

// HTTP request logging with pino-http
app.use(pinoHttp({
    logger,
    customLogLevel: (req, res, error) => {
        if (res.statusCode >= 500 || error) return 'error';
        if (res.statusCode === 404) return 'debug';
        if (res.statusCode >= 400) return 'warn';
        return 'debug';
    },
    customAttributeKeys: { req: 'request', res: 'response', err: 'error', responseTime: 'responseTimeMs' },
}));

// Cache tiers for static assets
const STATIC_SHORT_MAX_AGE = 300; // 5 minutes
const STATIC_LONG_MAX_AGE = 86_400; // 1 day
const IMMUTABLE_MAX_AGE = 31_536_000; // 1 year
const LONG_CACHE_RE = /\.(?:woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|ico|svg)$/i;
function setStaticCacheHeaders(res: express.Response, filePath: string): void {
    // A ?v= hash pins the URL to this exact content, so it can never need revalidating.
    if (res.req.query.v) {
        res.setHeader('Cache-Control', `public, max-age=${String(IMMUTABLE_MAX_AGE)}, immutable`);
        return;
    }
    const isVendorLibrary = filePath.includes(`${path.sep}lib${path.sep}`); // e.g. lib/motion.js
    const maxAge = LONG_CACHE_RE.test(filePath) || isVendorLibrary ? STATIC_LONG_MAX_AGE : STATIC_SHORT_MAX_AGE;
    res.setHeader('Cache-Control', `public, max-age=${String(maxAge)}`);
}

// Serve static files from user-assets first (takes precedence), then built-in public/
// This allows users to hot-load custom assets without rebuilding the Docker image
if (fs.existsSync(userAssetsPath)) {
    app.use(express.static(userAssetsPath, { setHeaders: setStaticCacheHeaders }));
}
// Serve the config-branded index for the root and direct requests. Registered after the
// user-assets mount (so a user-supplied index.html still wins) and before the public mount.
app.get(['/', '/index.html'], (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    res.type('html').send(renderedIndexHtml);
});
// Shared icon sprite, referenced as /icons.svg#icon-<name> from both pages and the scripts.
app.get('/icons.svg', (req, res) => {
    res.set('Cache-Control', `public, max-age=${String(STATIC_LONG_MAX_AGE)}`);
    res.type('image/svg+xml').send(iconSprite);
});
// Serve the site-URL-branded robots.txt / sitemap.xml before the static mount so they win.
app.get('/robots.txt', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('text/plain').send(renderedRobotsTxt);
});
app.get('/sitemap.xml', (req, res) => {
    res.set('Cache-Control', 'public, max-age=86400');
    res.type('application/xml').send(renderedSitemapXml);
});

app.use(express.static(path.join(__dirname, '..', 'public'), { setHeaders: setStaticCacheHeaders }));

// In-memory status cache, 60 s TTL, keyed per server so one unreachable server never delays
// the others. inFlight is the single-flight guard: one query per server id at a time.
const CACHE_TTL_MS = 60_000;
// A server that just failed is re-checked on this shorter interval instead of the full TTL.
const FAILURE_RETRY_MS = 10_000;
// Consecutive failed queries before a previously-online server is published as offline.
const OFFLINE_STRIKES = 2;
// Backstop for a query that never settles, well above GameDig's own give-up time.
const QUERY_WATCHDOG_MS = 30_000;
const statusCache = new Map<string, { data: ServerStatusData; expires: number }>();
const inFlight = new Map<string, Promise<void>>();
const failures = new Map<string, number>();

// Server status response type
interface ServerStatusData {
    id: string;
    name?: string;
    map: string;
    players: number;
    maxplayers: number;
    ping: number | undefined;
    status: 'online' | 'offline' | 'pending';
    host?: string;
    port?: number;
}

// Global rate limiter for all /api/* endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1200, // 80 req/min per IP. Cache hits are sub-millisecond; the expensive path (a GameDig
    // refresh) is capped by the cache TTL regardless, so this only needs to stop one IP hogging the
    // event loop while leaving room for many tabs behind a shared/CGNAT address.
    message: { success: false, message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req) ?? 'unknown'),
});

// Apply global rate limiter to all /api/* routes
app.use('/api', apiLimiter);

// Placeholder entry, shared by the offline and not-yet-queried cases.
const blankStatus = (server: ServerConfig, status: 'offline' | 'pending'): ServerStatusData => ({
    id: server.id,
    name: server.name ?? server.id,
    map: 'N/A',
    players: 0,
    maxplayers: 0,
    ping: undefined,
    status,
    host: server.host,
    port: server.port,
});

// Query one server. Never rejects; null means the query failed.
const queryServer = async (server: ServerConfig): Promise<ServerStatusData | null> => {
    try {
        const state = await GameDig.query({
            type: server.type,
            host: server.host,
            port: server.port,
            // An attempt is 2 datagrams costing 2x socketTimeout, and maxRetries below 2 never
            // retries, so 1 lost packet used to mean a false OFFLINE. Measured p99 is 130 ms.
            maxRetries: 2,
            socketTimeout: 1000,
        });

        logger.debug({ serverId: server.id, map: state.map, players: state.players.length, ping: state.ping }, `Server ${server.id} queried successfully`);

        return {
            id: server.id,
            name: state.name || (server.name ?? server.id),
            map: state.map || 'N/A',
            players: state.players.length,
            maxplayers: state.maxplayers,
            ping: state.ping,
            status: 'online' as const,
            host: server.host,
            port: server.port,
        };
    } catch {
        logger.warn({ serverId: server.id, host: server.host, port: server.port }, `Server ${server.id} query failed`);
        return null;
    }
};

// GameDig should always settle, but a query that never did would hold this server's inFlight
// slot forever and freeze its card at the last known value.
const withWatchdog = async (query: Promise<ServerStatusData | null>): Promise<ServerStatusData | null> => {
    let timer: NodeJS.Timeout | undefined;
    const watchdog = new Promise<null>((resolve) => {
        timer = setTimeout(() => { resolve(null); }, QUERY_WATCHDOG_MS);
    });
    try {
        return await Promise.race([query, watchdog]);
    } finally {
        clearTimeout(timer);
    }
};

// One failed query is usually transient (a lost packet burst, a brief A2S rate limit, a map
// change), so hold the last good data and re-check sooner. Offline is only published once a
// server has failed OFFLINE_STRIKES times in a row, or if it was never up to begin with.
const recordFailure = (server: ServerConfig): void => {
    const strikes = (failures.get(server.id) ?? 0) + 1;
    failures.set(server.id, strikes);

    const previous = statusCache.get(server.id);
    if (strikes < OFFLINE_STRIKES && previous?.data.status === 'online') {
        logger.debug({ serverId: server.id, strikes }, `Server ${server.id} query failed, holding last known state`);
        statusCache.set(server.id, { data: previous.data, expires: Date.now() + FAILURE_RETRY_MS });
        return;
    }
    statusCache.set(server.id, { data: blankStatus(server, 'offline'), expires: Date.now() + CACHE_TTL_MS });
};

// Fire off a refresh nobody waits for. Requests are served from the cache, so a slow server
// costs nothing but its own staleness.
const refreshServer = (server: ServerConfig): void => {
    if (inFlight.has(server.id)) { return; }
    const query = (async () => {
        try {
            const data = await withWatchdog(queryServer(server));
            if (data) {
                failures.delete(server.id);
                statusCache.set(server.id, { data, expires: Date.now() + CACHE_TTL_MS });
            } else {
                recordFailure(server);
            }
        } catch (error: unknown) {
            logger.error({ err: error, serverId: server.id }, `Server ${server.id} refresh failed`);
            recordFailure(server);
        } finally {
            inFlight.delete(server.id);
        }
    })();
    inFlight.set(server.id, query);
};

// API Route for server status. Never blocks on a query: expired entries are served stale
// while they refresh, and entries with no result yet come back as 'pending' for the client
// to poll for. One unreachable server therefore cannot hold up the whole grid.
app.get('/api/status', (req, res) => {
    try {
        const now = Date.now();
        let pending = 0;

        const data = config.servers.map((server: ServerConfig): ServerStatusData => {
            const hit = statusCache.get(server.id);
            if (!hit || hit.expires <= now) { refreshServer(server); }
            if (hit) { return hit.data; }

            pending++;
            return blankStatus(server, 'pending');
        });

        logger.debug({ serverCount: data.length, pending }, 'Server status served');
        // A pending payload is worthless in a minute, so keep proxies from pinning it.
        res.set('Cache-Control', pending > 0 ? 'no-store' : 'public, max-age=60, s-maxage=60');
        return res.json({ success: true, fromCache: pending === 0, pending, data });
    } catch (error) {
        logger.error({ err: error }, 'Server status error');
        // Use 'message' property instead of 'error' for API clarity
        return res.status(500).json({ success: false, message: 'Failed to fetch server status' });
    }
});

// Health check endpoint — restricted to localhost only
app.get('/health', (req, res) => {
    // The raw socket peer, never req.ip or a forwarded header: no proxy setting can open this up.
    const peer = req.socket.remoteAddress;
    if (peer !== '127.0.0.1' && peer !== '::1' && peer !== '::ffff:127.0.0.1') {
        return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler: serve the branded HTML page to browsers, JSON to API/non-HTML clients
app.use((req, res) => {
    res.status(404);
    if (req.path.startsWith('/api/') || !req.accepts('html')) {
        res.json({ success: false, message: 'Not found' });
    } else {
        res.type('html').send(rendered404Html);
    }
});

// Express error handling middleware (4-argument signature)
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error({ err: error }, 'Server error');
    if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    } else {
        next(error);
    }
});

const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT, pid: process.pid, env: process.env.NODE_ENV ?? 'development' }, "Sneak's Community Website running");

    // Signal readiness for process managers that support it (e.g., PM2 cluster mode)
    if (process.send) {
        process.send('ready');
    }
});

// Graceful shutdown: on docker stop / redeploy, stop accepting new connections and
// let in-flight requests (e.g. an active GameDig batch) finish before exiting.
let shuttingDown = false;
const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Received shutdown signal, closing server');

    // Force-exit safety net below Docker's default 10s stop grace period, so a hung
    // keep-alive connection can't wedge server.close() and trigger SIGKILL instead.
    const forceExit = setTimeout(() => {
        logger.error('Shutdown timed out, forcing exit');
        process.exit(1);
    }, 8000);
    forceExit.unref();

    server.close((error) => {
        if (error) {
            logger.error({ err: error }, 'Error during server shutdown');
            process.exit(1);
        }
        logger.info('Server closed cleanly');
        process.exit(0);
    });

    // Close idle keep-alive sockets so shutdown doesn't wait on the force-exit timer.
    server.closeIdleConnections();
};

process.on('SIGTERM', () => { shutdown('SIGTERM'); });
process.on('SIGINT', () => { shutdown('SIGINT'); });
