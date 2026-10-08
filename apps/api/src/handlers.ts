import { payloadSchema } from './validation.js';
export class CancelledError extends Error { constructor() { super('Job cancelled'); } }
export class DemoFailure extends Error { constructor() { super('Demo failure requested'); } }
export async function runHandler(type: string, payload: unknown, attempt: number, assertActive: () => Promise<void>) {
  const job = payloadSchema.parse({ type, payload });
  await assertActive();
  switch (job.type) {
    case 'echo': return { message: job.payload.message };
    case 'sum': return { sum: job.payload.numbers.reduce((a, b) => a + b, 0) };
    case 'flaky':
      if (attempt <= job.payload.failuresBeforeSuccess) throw new DemoFailure();
      return { message: job.payload.message, attempt };
    case 'sleep': {
      const until = Date.now() + job.payload.durationMs;
      while (Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, Math.min(100, until - Date.now())));
        await assertActive();
      }
      return { sleptMs: job.payload.durationMs };
    }
  }
}
