import pino from 'pino';
// Log only operational identifiers. Never pass request bodies, headers, payloads or raw errors.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: { paths: ['token', 'authorization', 'password', 'secret', 'payload', 'req.headers.authorization', 'req.body', '*.token', '*.password', '*.secret', '*.payload'], censor: '[REDACTED]' },
});
