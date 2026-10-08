import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import request from 'supertest';
import { Worker } from 'bullmq';
import { config } from '../apps/api/src/config.js';
import { db } from '../apps/api/src/db.js';
import { createQueues } from '../apps/api/src/queue.js';
import { createDispatcher } from '../apps/api/src/dispatch.js';
import { processJob } from '../apps/api/src/processor.js';
import { createApp } from '../apps/api/src/app.js';
config.QUEUE_PREFIX = `test-${randomUUID()}`;
const queues = createQueues();
const dispatch = createDispatcher(queues);
const app = createApp({ ping: () => queues.connection.ping(), coordination: async () => ({ workers: 1, dispatcher: true }) });
const auth = `Bearer ${config.DEMO_API_TOKEN}`;
const ids: string[] = [];
const children: ChildProcess[] = [];
let worker: Worker;
async function waitFor<T>(fn: () => Promise<T>, check: (value: T) => boolean, timeout = 15000): Promise<T> {
  const until = Date.now() + timeout;
  while (Date.now() < until) { const value = await fn(); if (check(value)) return value; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Timed out waiting for job state');
}
async function enqueue(input: object) {
  const res = await request(app).post('/api/jobs').set('Authorization', auth).send(input);
  expect(res.status).toBe(201); ids.push(res.body.job.id); return res.body.job.id as string;
}
function startWorker() {
  const w = new Worker('jobs', processJob, { connection: queues.connection, prefix: config.QUEUE_PREFIX, concurrency: 2, lockDuration: 1000, stalledInterval: 1000, maxStalledCount: 2 });
  w.on('error', () => {}); return w;
}
beforeAll(async () => { await db.$connect(); worker = startWorker(); await worker.waitUntilReady(); });
afterAll(async () => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
  await worker.close();
  await queues.jobs.obliterate({ force: true }); await queues.dead.obliterate({ force: true });
  await queues.close(); await db.job.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect();
});
describe('Redis queue and worker', () => {
  it('dispatches concurrently without duplicate executions and survives outbox replay', async () => {
    const id = await enqueue({ type: 'sum', payload: { numbers: [2, 3, 4] } });
    await Promise.all([dispatch(), createDispatcher(queues)()]);
    const done = await waitFor(() => db.job.findUniqueOrThrow({ where: { id } }), j => j.status === 'succeeded');
    expect(done.result).toEqual({ sum: 9 }); expect(done.attempts).toBe(1);
    await db.outbox.update({ where: { jobId: id }, data: { publishedAt: null } });
    await dispatch();
    expect(await queues.jobs.getJobCountByTypes('completed')).toBe(1);
    expect(await db.jobEvent.count({ where: { jobId: id, kind: 'running' } })).toBe(1);
  });
  it('retries with exponential backoff and succeeds', async () => {
    const id = await enqueue({ type: 'flaky', payload: { failuresBeforeSuccess: 2, message: 'ok' }, backoffMs: 100, maxAttempts: 3 });
    await dispatch();
    const done = await waitFor(() => db.job.findUniqueOrThrow({ where: { id }, include: { history: { orderBy: { id: 'asc' } } } }), j => j.status === 'succeeded');
    expect(done.attempts).toBe(3); expect(done.history.filter(h => h.kind === 'retry')).toHaveLength(2);
    const starts = done.history.filter(h => h.kind === 'running');
    expect(starts[1].createdAt.getTime() - starts[0].createdAt.getTime()).toBeGreaterThanOrEqual(100);
    expect(starts[2].createdAt.getTime() - starts[1].createdAt.getTime()).toBeGreaterThanOrEqual(200);
  });
  it('persists exhausted failures and publishes the dead-letter queue', async () => {
    const id = await enqueue({ type: 'flaky', payload: { failuresBeforeSuccess: 9, message: 'fail' }, maxAttempts: 2, backoffMs: 100 });
    await dispatch();
    const failed = await waitFor(() => db.job.findUniqueOrThrow({ where: { id }, include: { deadLetter: true } }), j => j.status === 'failed');
    expect(failed.attempts).toBe(2); expect(failed.deadLetter?.reason).toBe('Demo failure requested');
    await dispatch(); expect((await queues.dead.getJob(id))?.data.jobId).toBe(id);
  });
  it('does not execute scheduled jobs early', async () => {
    const due = Date.now() + 1200;
    const id = await enqueue({ type: 'echo', payload: { message: 'scheduled' }, runAt: new Date(due).toISOString() });
    await dispatch();
    expect(await (await queues.jobs.getJob(id))?.getState()).toBe('delayed');
    const done = await waitFor(() => db.job.findUniqueOrThrow({ where: { id } }), j => j.status === 'succeeded');
    expect(done.startedAt!.getTime()).toBeGreaterThanOrEqual(due);
  });
  it('cancels queued and running jobs without recording success', async () => {
    const queuedId = await enqueue({ type: 'echo', payload: { message: 'cancel' }, runAt: new Date(Date.now() + 60000).toISOString() });
    await request(app).post(`/api/jobs/${queuedId}/cancel`).set('Authorization', auth); await dispatch();
    expect(await queues.jobs.getJob(queuedId)).toBeUndefined();
    const id = await enqueue({ type: 'sleep', payload: { durationMs: 5000 } }); await dispatch();
    await waitFor(() => db.job.findUniqueOrThrow({ where: { id } }), j => j.status === 'running');
    expect((await request(app).post(`/api/jobs/${id}/cancel`).set('Authorization', auth)).status).toBe(200);
    await waitFor(async () => (await queues.jobs.getJob(id))?.getState(), s => s === 'failed');
    const job = await db.job.findUniqueOrThrow({ where: { id }, include: { deadLetter: true } });
    expect(job.status).toBe('cancelled'); expect(job.result).toBeNull(); expect(job.deadLetter).toBeNull();
  });
  it('recovers a claimed job after killing its worker process', async () => {
    await worker.close();
    const victim = spawn(process.execPath, ['--import', 'tsx', 'apps/api/src/worker.ts'], {
      env: { ...process.env, QUEUE_PREFIX: config.QUEUE_PREFIX, WORKER_LOCK_MS: '1000', STALLED_INTERVAL_MS: '1000', WORKER_CONCURRENCY: '1', LOG_LEVEL: 'silent' }, stdio: 'ignore',
    }); children.push(victim);
    const id = await enqueue({ type: 'sleep', payload: { durationMs: 3000 }, maxAttempts: 3 }); await dispatch();
    await waitFor(() => db.job.findUniqueOrThrow({ where: { id } }), j => j.status === 'running');
    victim.kill('SIGKILL'); await once(victim, 'exit');
    worker = startWorker(); await worker.waitUntilReady();
    const recovered = await waitFor(() => db.job.findUniqueOrThrow({ where: { id } }), j => j.status === 'succeeded');
    expect(recovered.attempts).toBe(2);
  });
});
