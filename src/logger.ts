import pino from 'pino';

// Extend Pino's LogFnFields interface for custom properties
// LogFnFields is a Pino library interface name (allowed in unicorn/prevent-abbreviations)
declare module 'pino' {
  interface LogFnFields {
    requestId?: string;
    serverId?: string;
  }
}

const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL;
const effectiveLogLevel = logLevel?.length ? logLevel : (isDevelopment ? 'debug' : 'info');

export const logger = pino({
  level: effectiveLogLevel,
  // Redact sensitive request headers from pino-http logs
  redact: ['request.headers.cookie', 'request.headers.authorization'],
  formatters: {
    level: (levelLabel) => ({ level: levelLabel.toUpperCase() }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : {}),
});
