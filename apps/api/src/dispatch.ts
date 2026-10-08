import { db } from './db.js';
import type { Queues } from './queue.js';
import { markDead } from './processor.js';
export function createDispatcher(queues: Queues) {
  let cursor: string | undefined;
  return async function dispatchOnce() {
    const pending = await db.outbox.findMany({ where: { publishedAt: null }, orderBy: { createdAt: 'asc' }, take: 100, include: { job: true } });
    for (const item of pending) {
      const job = item.job;
      if (job.status === 'queued') await queues.jobs.add(job.type, { jobId: job.id }, {
        jobId: job.id, attempts: job.maxAttempts,
        backoff: { type: 'exponential', delay: job.backoffMs },
        delay: Math.max(0, job.scheduledAt.getTime() - Date.now()),
        // Retain job IDs so dispatch replay cannot enqueue duplicate executions.
        removeOnComplete: false, removeOnFail: false,
      });
      await db.outbox.updateMany({ where: { jobId: job.id, publishedAt: null }, data: { publishedAt: new Date() } });
    }
    // Recover final failures outside the processor (e.g. repeated worker crashes).
    // Rotate by ID to avoid starving later jobs behind a long scheduled backlog.
    const live = await db.job.findMany({ where: { status: { in: ['queued', 'running'] }, outbox: { publishedAt: { not: null } }, ...(cursor ? { id: { gt: cursor } } : {}) }, orderBy: { id: 'asc' }, take: 100 });
    for (const job of live) {
      const queued = await queues.jobs.getJob(job.id);
      if (queued && await queued.getState() === 'failed') await markDead(job.id, 'Queue execution failed or lease recovery exhausted');
      if (!queued) {
        // Redis data loss: replay only nonterminal database jobs using their remaining budget.
        await db.outbox.update({ where: { jobId: job.id }, data: { publishedAt: null } });
      }
    }
    cursor = live.length === 100 ? live[live.length - 1].id : undefined;
    const dead = await db.deadLetter.findMany({ where: { deliveredAt: null }, orderBy: { createdAt: 'asc' }, take: 100 });
    for (const item of dead) {
      await queues.dead.add('dead-letter', { jobId: item.jobId, reason: item.reason }, { jobId: item.jobId, removeOnComplete: false, removeOnFail: false });
      await db.deadLetter.update({ where: { jobId: item.jobId }, data: { deliveredAt: new Date() } });
    }
  };
}
