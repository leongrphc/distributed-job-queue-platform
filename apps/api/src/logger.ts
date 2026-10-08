import pino, { type DestinationStream } from 'pino';
// Log only operational identifiers. Never pass request bodies, headers, payloads or raw errors.
export function createLogger(destination?: DestinationStream) { return pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['token', 'authorization', 'password', 'secret', 'payload', 'req.headers.authorization', 'req.body', '*.token', '*.password', '*.secret', '*.payload', 'err', 'req.headers.cookie', '*.authorization'], censor: '[REDACTED]' },
}, destination); }
export const logger = createLogger();
