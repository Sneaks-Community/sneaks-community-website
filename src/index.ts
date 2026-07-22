import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
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

// Read and validate configuration
const configPath = path.join(__dirname, '..', 'config', 'config.json');
let config: AppConfig;

try {
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
    // Logo tokens are trusted HTML markup (not user text), so they are injected raw. logoPath is
    // one of three fixed internal filenames, so there is nothing to escape.
    ['logoContainerClass', logoPath ? 'has-logo' : 'bg-brand-500 font-black'],
    ['logoContainerInner', logoPath
        ? `<img src="${logoPath}" alt="Logo">`
        : '<svg id="crosshairIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" class="w-5 h-5"><use href="#icon-crosshair"/></svg>'],
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
let renderedIndexHtml: string;
let rendered404Html: string;
let renderedRobotsTxt: string;
let renderedSitemapXml: string;
try {
    renderedIndexHtml = renderBranding(fs.readFileSync(indexHtmlPath, 'utf-8'));
    rendered404Html = renderBranding(fs.readFileSync(notFoundHtmlPath, 'utf-8'));
    renderedRobotsTxt = fs.readFileSync(robotsTxtPath, 'utf-8').replaceAll('{{siteUrl}}', () => siteUrl);
    renderedSitemapXml = fs.readFileSync(sitemapXmlPath, 'utf-8').replaceAll('{{siteUrl}}', () => siteUrl);
} catch (error) {
    logger.fatal({ err: error }, 'Failed to read HTML template');
    process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// trust proxy config: only enable behind a trusted reverse proxy, or clients can spoof
// X-Forwarded-For to bypass the /health IP guard and the rate limiter. Default off.
// Accepts: false (default), true, a hop count (e.g. "1"), or a comma-separated IP/CIDR list.
function parseTrustProxy(raw: string | undefined): boolean | number | string {
    const value = (raw ?? '').trim();
    if (value === '' || value.toLowerCase() === 'false') return false;
    if (value.toLowerCase() === 'true') return true;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
}
const TRUST_PROXY = parseTrustProxy(process.env.TRUST_PROXY);

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

// Restrict CORS to allowed origins instead of allowing all
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()) ?? ['http://localhost:3000'];
app.use(cors({
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
const LONG_CACHE_RE = /\.(?:woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|ico|svg)$/i;
function setStaticCacheHeaders(res: express.Response, filePath: string): void {
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

// Trust proxy for proper IP detection behind reverse proxies (required for express-rate-limit)
app.set('trust proxy', TRUST_PROXY);

// In-memory cache for server queries (60 seconds TTL)
const CACHE_TTL_MS = 60_000;
let cached: { data: ServerStatusData[]; expires: number } | null = null;
// Single-flight guard: concurrent cache-miss requests share one in-flight GameDig batch query
let updatePromise: Promise<ServerStatusData[]> | null = null;

// Server status response type
interface ServerStatusData {
    id: string;
    name?: string;
    map: string;
    players: number;
    maxplayers: number;
    ping: number | undefined;
    status: 'online' | 'offline';
    host?: string;
    port?: number;
}

// Global rate limiter for all /api/* endpoints
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 240, // 240 requests per 15 minutes per IP (headroom for client polling + shared/CGNAT IPs)
    message: { success: false, message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply global rate limiter to all /api/* routes
app.use('/api', apiLimiter);

// API Route for server status
app.get('/api/status', async (req, res) => {
    try {
        const cachedStatus = cached && cached.expires > Date.now() ? cached.data : null;
        if (cachedStatus) {
            logger.debug({ serverCount: cachedStatus.length }, 'Server status returned from cache');
            res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
            return res.json({ success: true, fromCache: true, data: cachedStatus });
        }

        logger.info({ serverCount: config.servers.length }, 'Cache miss, querying servers');
        updatePromise ??= (async () => {
            try {
                const serversData: ServerStatusData[] = await Promise.all(
                    config.servers.map(async (server: ServerConfig) => {
                        try {
                            const state = await GameDig.query({
                                type: server.type,
                                host: server.host,
                                port: server.port,
                                maxRetries: 1,
                                socketTimeout: 5000,
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

                            // Return default offline data instead of result.reason (which could be an Error object)
                            return {
                                id: server.id,
                                name: server.name ?? server.id,
                                map: 'N/A',
                                players: 0,
                                maxplayers: 0,
                                ping: undefined,
                                status: 'offline' as const,
                                host: server.host,
                                port: server.port,
                            };
                        }
                    })
                );

                cached = { data: serversData, expires: Date.now() + CACHE_TTL_MS };
                return serversData;
            } finally {
                // Always clear the in-flight promise, whether it succeeds or fails
                updatePromise = null;
            }
        })();

        const serversData = await updatePromise;
        res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
        return res.json({ success: true, fromCache: false, data: serversData });
    } catch (error) {
        logger.error({ err: error }, 'Server status error');
        // Use 'message' property instead of 'error' for API clarity
        return res.status(500).json({ success: false, message: 'Failed to fetch server status' });
    }
});

// Health check endpoint — restricted to localhost only
app.get('/health', (req, res) => {
    const ip = req.ip;
    if (ip !== '::1' && ip !== '127.0.0.1') {
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
