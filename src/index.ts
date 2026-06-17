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

// Community branding used to render the page title and headings, configured via
// environment variables (with fallbacks) like the social links below.
const communityName = (process.env.COMMUNITY_NAME ?? '').trim() || "Sneak's Community";
const communityEstablished = Number(process.env.COMMUNITY_ESTABLISHED) || 2015;

// Validate each server entry has required fields
for (const server of config.servers) {
    if (!server.id || !server.host || !server.port || !server.type) {
        logger.fatal({ serverId: server.id || 'unknown' }, `Invalid server config: missing required fields for server "${server.id || 'unknown'}"`);
        process.exit(1);
    }
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

const renderBranding = (html: string): string =>
    html
        .replaceAll('{{communityName}}', escapeHtml(communityName))
        .replaceAll('{{established}}', String(communityEstablished));

const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
const notFoundHtmlPath = path.join(__dirname, '..', 'public', '404.html');
let renderedIndexHtml: string;
let rendered404Html: string;
try {
    renderedIndexHtml = renderBranding(fs.readFileSync(indexHtmlPath, 'utf-8'));
    rendered404Html = renderBranding(fs.readFileSync(notFoundHtmlPath, 'utf-8'));
} catch (error) {
    logger.fatal({ err: error }, 'Failed to read HTML template');
    process.exit(1);
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'"],
            fontSrc: ["'self'"],
            imgSrc: ["'self'", "https:"],
            frameSrc: ["https://discord.com"],
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
        return 'info';
    },
    customAttributeKeys: { req: 'request', res: 'response', err: 'error', responseTime: 'responseTimeMs' },
}));

// Serve static files from user-assets first (takes precedence), then built-in public/
// This allows users to hot-load custom assets without rebuilding the Docker image
const userAssetsPath = path.join(__dirname, '..', 'user-assets');
if (fs.existsSync(userAssetsPath)) {
    app.use(express.static(userAssetsPath));
}
// Serve the config-branded index for the root and direct requests. Registered after the
// user-assets mount (so a user-supplied index.html still wins) and before the public mount.
app.get(['/', '/index.html'], (req, res) => {
    res.type('html').send(renderedIndexHtml);
});
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// Trust proxy for proper IP detection behind reverse proxies (required for express-rate-limit)
app.set('trust proxy', 1);

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
    max: 60, // 60 requests per 15 minutes per IP
    message: { success: false, error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply global rate limiter to all /api/* routes
app.use('/api', apiLimiter);

// API Route for config
app.get('/api/config', (req, res) => {
    res.json({
        steamLink: process.env.STEAM_LINK ?? "https://steamcommunity.com/groups/sneakscommunity",
        twitchLink: process.env.TWITCH_LINK ?? "https://twitch.tv/snksrv",
        githubLink: process.env.GITHUB_LINK ?? "https://github.com/Sneaks-Community",
        discordWidgetId: process.env.DISCORD_WIDGET_ID ?? "",
    });
});

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
                                name: state.name || server.name,
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
                                name: server.name,
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
        return res.status(403).json({ success: false, error: 'Forbidden' });
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

app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT, pid: process.pid, env: process.env.NODE_ENV ?? 'development' }, "Sneak's Community Website running");

    // Signal readiness for process managers that support it (e.g., PM2 cluster mode)
    if (process.send) {
        process.send('ready');
    }

    // Set clean exit code so the process terminates gracefully if needed
    process.exitCode = 0;
});
