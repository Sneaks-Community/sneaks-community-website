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

export const logger = pino({
  level: isDevelopment ? 'debug' : 'info',
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
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
