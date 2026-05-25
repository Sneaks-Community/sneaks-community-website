import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import compression from 'compression';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { GameDig } from 'gamedig';
import helmet from 'helmet';
import NodeCache from 'node-cache';
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
    community: {
        name: string;
        established: number;
        discordLink: string;
    };
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

// Validate each server entry has required fields
for (const server of config.servers) {
    if (!server.id || !server.host || !server.port || !server.type) {
        logger.fatal({ serverId: server.id || 'unknown' }, `Invalid server config: missing required fields for server "${server.id || 'unknown'}"`);
        process.exit(1);
    }
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
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
    allowedHeaders: ['Content-Type', 'Authorization'],
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
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json({ limit: '10kb' }));

// Trust proxy for proper IP detection behind reverse proxies (required for express-rate-limit)
app.set('trust proxy', 1);

// Set up node-cache for server queries (60 seconds TTL)
const cache = new NodeCache({ stdTTL: 60 });
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

// Rate limiter for /api/status to prevent abuse
const statusLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per IP
    message: { success: false, error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

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
app.get('/api/status', statusLimiter, async (req, res) => {
    try {
        const cachedStatus = cache.get('server_status');
        if (cachedStatus) {
            const statusData = cachedStatus as ServerStatusData[];
            logger.debug({ serverCount: statusData.length }, 'Server status returned from cache');
            res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
            return res.json({ success: true, fromCache: true, data: cachedStatus });
        }

        logger.info({ serverCount: config.servers.length }, 'Cache miss, querying servers');
        updatePromise ??= (async () => {
            try {
                const results = await Promise.allSettled(
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

                // Safely extract data, never pass Error objects to the client
                const serversData: ServerStatusData[] = results.map(result => {
                    if (result.status === 'fulfilled') {
                        return result.value;
                    }
                    // Fallback for rejected promises - use safe default object
                    return {
                        id: 'unknown',
                        name: 'Unknown Server',
                        map: 'N/A',
                        players: 0,
                        maxplayers: 0,
                        ping: undefined,
                        status: 'offline' as const,
                    };
                });

                cache.set('server_status', serversData);
                return serversData;
            } finally {
                // Always clear the promise, whether it succeeds or fails
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

// Health check endpoint (must be before 404 handler)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Express 404 handler for non-JSON API routes
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not found' });
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
