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


// Global error handlers to prevent unhandled rejections from crashing silently
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
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
} catch (error) {
    console.error('Failed to load configuration:', error);
    process.exit(1);
}

if (!Array.isArray(config.servers) || config.servers.length === 0) {
    console.error('Invalid configuration: "servers" array is required and must not be empty');
    process.exit(1);
}

// Validate each server entry has required fields
for (const server of config.servers) {
    if (!server.id || !server.host || !server.port || !server.type) {
        console.error(`Invalid server config: missing required fields for server "${server.id || 'unknown'}"`);
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
            imgSrc: ["'self'", "data:", "https:"],
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
            res.set('Cache-Control', 'public, max-age=60, s-maxage=60');
            return res.json({ success: true, fromCache: true, data: cachedStatus });
        }

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
                                // Return default offline data instead of result.reason (which could be an Error object)
                                return {
                                    id: server.id,
                                    name: server.name,
                                    map: 'N/A',
                                    players: 0,
                                    maxplayers: 0,
                                    ping: 0,
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
                            ping: 0,
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
        console.error('Server status error:', error);
        // Use 'message' property instead of 'error' for API clarity
        return res.status(500).json({ success: false, message: 'Failed to fetch server status' });
    }
});

// Express 404 handler for non-JSON API routes
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not found' });
});

// Express error handling middleware (4-argument signature)
app.use((error: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Server error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sneak's Community Website running on http://localhost:${String(PORT)}`);
});
