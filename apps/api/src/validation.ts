import { z } from 'zod';
import { createHash } from 'node:crypto';
export const payloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('echo'), payload: z.object({ message: z.string().max(2000) }).strict() }).strict(),
  z.object({ type: z.literal('sum'), payload: z.object({ numbers: z.array(z.number().finite().min(-1e12).max(1e12)).min(1).max(100) }).strict() }).strict(),
  z.object({ type: z.literal('flaky'), payload: z.object({ failuresBeforeSuccess: z.number().int().min(0).max(9), message: z.string().max(2000) }).strict() }).strict(),
  z.object({ type: z.literal('sleep'), payload: z.object({ durationMs: z.number().int().min(10).max(30000) }).strict() }).strict(),
]);
export const enqueueSchema = z.object({
  type: z.enum(['echo', 'sum', 'flaky', 'sleep']), payload: z.unknown(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  backoffMs: z.number().int().min(100).max(60000).default(1000),
  runAt: z.iso.datetime({ offset: true }).optional(),
}).strict().superRefine((value, ctx) => {
  const result = payloadSchema.safeParse({ type: value.type, payload: value.payload });
  if (!result.success) ctx.addIssue({ code: 'custom', path: ['payload'], message: 'Invalid payload for selected handler' });
  if (value.runAt && new Date(value.runAt).getTime() > Date.now() + 30 * 86400000) {
    ctx.addIssue({ code: 'custom', path: ['runAt'], message: 'Schedule must be within 30 days' });
  }
});
export const listSchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']).optional(),
  type: z.enum(['echo', 'sum', 'flaky', 'sleep']).optional(),
  deadLetter: z.enum(['true', 'false']).optional(),
}).strict();
export const keySchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/);
export const idSchema = z.uuid();
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}
export function fingerprint(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex'); }
