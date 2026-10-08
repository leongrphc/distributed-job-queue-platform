import { describe, it, expect } from 'vitest';
import { enqueueSchema, fingerprint, listSchema, keySchema } from '../apps/api/src/validation.js';
describe('job validation', () => {
  it('accepts each demo handler', () => {
    for (const job of [{ type: 'echo', payload: { message: 'hello' } }, { type: 'sum', payload: { numbers: [1, 2] } }, { type: 'flaky', payload: { failuresBeforeSuccess: 2, message: 'retry' } }, { type: 'sleep', payload: { durationMs: 500 } }]) expect(enqueueSchema.safeParse(job).success).toBe(true);
  });
  it('rejects unknown handlers, extra fields and unsafe bounds', () => {
    for (const job of [{ type: 'exec', payload: {} }, { type: 'echo', payload: { message: 'hello', token: 'secret' } }, { type: 'sum', payload: { numbers: [Infinity] } }, { type: 'sleep', payload: { durationMs: 999999 } }, { type: 'echo', payload: { message: 'ok' }, maxAttempts: 0 }, { type: 'echo', payload: { message: 'ok' }, runAt: '2099-01-01T00:00:00Z' }]) expect(enqueueSchema.safeParse(job).success).toBe(false);
  });
  it('bounds pagination and idempotency keys', () => {
    expect(listSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(listSchema.safeParse({ page: -1 }).success).toBe(false);
    expect(keySchema.safeParse('bad\nkey').success).toBe(false);
  });
  it('hashes equivalent requests identically regardless of property order', () => {
    expect(fingerprint({ type: 'echo', payload: { message: 'x' } })).toBe(fingerprint({ payload: { message: 'x' }, type: 'echo' }));
    expect(fingerprint({ payload: { message: 'x' } })).not.toBe(fingerprint({ payload: { message: 'y' } }));
  });
});
