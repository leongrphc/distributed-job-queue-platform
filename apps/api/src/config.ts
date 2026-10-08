import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
import { z } from 'zod';
const schema = z.object({
  DATABASE_URL: z.url(), REDIS_URL: z.url(), DEMO_API_TOKEN: z.string().min(16).max(256),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  QUEUE_PREFIX: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('djqp'),
  WORKER_LOCK_MS: z.coerce.number().int().min(1000).default(15000),
  STALLED_INTERVAL_MS: z.coerce.number().int().min(1000).default(15000),
});
export const config = schema.parse(process.env);
