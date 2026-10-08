import { randomUUID } from 'node:crypto';
import { UnrecoverableError, type Job as QueueJob } from 'bullmq';
import { db } from './db.js';
import { runHandler, CancelledError, DemoFailure } from './handlers.js';
import { logger } from './logger.js';

export async function markDead(jobId: string, reason: string, runToken?: string) {
  return db.$transaction(async tx => {
    const changed = await tx.job.updateMany({ where: { id: jobId, status: { in: ['queued', 'running'] }, ...(runToken ? { runToken } : {}) }, data: { status: 'failed', error: reason, finishedAt: new Date(), runToken: null } });
    if (changed.count) {
      await tx.deadLetter.upsert({ where: { jobId }, create: { jobId, reason }, update: {} });
      const record = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
      await tx.jobEvent.create({ data: { jobId, kind: 'failed', attempt: record.attempts, message: reason } });
    }
    return Boolean(changed.count);
  });
}
export async function processJob(queueJob: QueueJob<{ jobId: string }>) {
  const jobId = queueJob.data.jobId;
  const runToken = randomUUID();
  const record = await db.$transaction(async tx => {
    // BullMQ owns the renewable Redis lease. A new token fences writes from an old claim.
    const changed = await tx.job.updateMany({ where: { id: jobId, status: { in: ['queued', 'running'] }, attempts: { lt: tx.job.fields.maxAttempts } }, data: { status: 'running', runToken, attempts: { increment: 1 }, startedAt: new Date(), error: null } });
    if (!changed.count) return null;
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });
    await tx.jobEvent.create({ data: { jobId, kind: 'running', attempt: job.attempts, message: `Claimed by worker; execution ${job.attempts}` } });
    return job;
  });
  if (!record) {
    const existing = await db.job.findUnique({ where: { id: jobId } });
    if (existing && ['queued', 'running'].includes(existing.status) && existing.attempts >= existing.maxAttempts) {
      await markDead(jobId, 'Execution budget exhausted during lease recovery');
      throw new UnrecoverableError('Execution budget exhausted');
    }
    return; // Cancellation or completed-before-ack recovery.
  }
  const assertActive = async () => {
    const current = await db.job.findUnique({ where: { id: jobId }, select: { status: true, runToken: true } });
    if (!current || current.status !== 'running' || current.runToken !== runToken) throw new CancelledError();
  };
  try {
    const result = await runHandler(record.type, record.payload, record.attempts, assertActive);
    const succeeded = await db.$transaction(async tx => {
      const changed = await tx.job.updateMany({ where: { id: jobId, status: 'running', runToken }, data: { status: 'succeeded', result, finishedAt: new Date(), runToken: null } });
      if (changed.count) await tx.jobEvent.create({ data: { jobId, kind: 'succeeded', attempt: record.attempts } });
      return Boolean(changed.count);
    });
    if (!succeeded) return;
    logger.info({ jobId, attempt: record.attempts, state: 'succeeded' }, 'job execution finished');
    return result;
  } catch (error) {
    if (error instanceof CancelledError) throw new UnrecoverableError('Job cancelled or claim replaced');
    // Use fixed messages: errors can include secrets or database connection strings.
    const reason = error instanceof DemoFailure ? 'Demo failure requested' : 'Handler execution failed';
    const exhausted = record.attempts >= record.maxAttempts || queueJob.attemptsMade + 1 >= record.maxAttempts;
    const transitioned = exhausted ? await markDead(jobId, reason, runToken) : await db.$transaction(async tx => {
      const changed = await tx.job.updateMany({ where: { id: jobId, status: 'running', runToken }, data: { status: 'queued', runToken: null, error: reason } });
      if (changed.count) await tx.jobEvent.create({ data: { jobId, kind: 'retry', attempt: record.attempts, message: `${reason}; retry after ${record.backoffMs * 2 ** queueJob.attemptsMade}ms` } });
      return Boolean(changed.count);
    });
    if (!transitioned) throw new UnrecoverableError('Job cancelled or claim replaced');
    logger.warn({ jobId, attempt: record.attempts, state: exhausted ? 'failed' : 'queued' }, 'job execution failed');
    if (exhausted) throw new UnrecoverableError(reason);
    throw new Error(reason);
  }
}
