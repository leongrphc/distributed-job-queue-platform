import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit, type Store } from 'express-rate-limit';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { Prisma } from '@queue/db';
import { db } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { enqueueSchema, listSchema, keySchema, idSchema, fingerprint } from './validation.js';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export interface Dependencies {
  ping: () => Promise<unknown>;
  coordination: () => Promise<{ workers: number; dispatcher: boolean }>;
  rateStore?: Store;
}
export function createApp(deps: Dependencies) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    const started = Date.now();
    res.on('finish', () => logger.info({ requestId, method: req.method, status: res.statusCode, durationMs: Date.now() - started }, 'request'));
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try {
      await Promise.all([db.$queryRaw`SELECT 1`, deps.ping()]);
      const coordination = await deps.coordination();
      const ready = coordination.workers > 0 && coordination.dispatcher;
      res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'waiting', database: true, redis: true, ...coordination });
    } catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, store: deps.rateStore, message: { error: 'Rate limit exceeded' } }));
  app.use('/api', (req, _res, next) => {
    const received = Buffer.from(req.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${config.DEMO_API_TOKEN}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return next(new HttpError(401, 'Demo authorization required'));
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/auth/check', (_req, res) => res.json({ authorized: true }));
  app.post('/api/jobs', async (req, res) => {
    const parsed = enqueueSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid job: check handler payload, attempts, backoff and schedule');
    const input = parsed.data;
    const rawKey = req.headers['idempotency-key'];
    const key = rawKey === undefined ? undefined : keySchema.safeParse(rawKey);
    if (key && !key.success) throw new HttpError(400, 'Invalid Idempotency-Key');
    const idempotencyKey = key?.success ? key.data : undefined;
    const hash = fingerprint(input);
    try {
      const job = await db.job.create({ data: {
        type: input.type, payload: input.payload as Prisma.InputJsonValue, fingerprint: hash, idempotencyKey,
        maxAttempts: input.maxAttempts, backoffMs: input.backoffMs,
        scheduledAt: input.runAt ? new Date(input.runAt) : undefined,
        history: { create: { kind: 'queued', message: input.runAt ? 'Scheduled job accepted' : 'Job accepted' } },
        outbox: { create: {} },
      } });
      res.status(201).json({ job, replayed: false });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && idempotencyKey) {
        const job = await db.job.findUniqueOrThrow({ where: { idempotencyKey } });
        if (job.fingerprint !== hash) throw new HttpError(409, 'Idempotency key already used for a different request');
        res.status(200).json({ job, replayed: true });
      } else throw error;
    }
  });
  app.get('/api/jobs', async (req, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'Invalid filters or pagination');
    const { page, pageSize, status, type, deadLetter } = parsed.data;
    const where: Prisma.JobWhereInput = { status, type, ...(deadLetter === 'true' ? { deadLetter: { isNot: null } } : deadLetter === 'false' ? { deadLetter: { is: null } } : {}) };
    const [total, jobs] = await db.$transaction([
      db.job.count({ where }),
      db.job.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, type: true, status: true, attempts: true, maxAttempts: true, createdAt: true, scheduledAt: true, finishedAt: true, deadLetter: { select: { createdAt: true } } } }),
    ], { isolationLevel: 'RepeatableRead' });
    res.json({ jobs, total, page, pageSize, pages: Math.ceil(total / pageSize) });
  });
  app.get('/api/jobs/:id', async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, 'Invalid job ID');
    const job = await db.job.findUnique({ where: { id: id.data }, include: { history: { orderBy: { id: 'asc' } }, deadLetter: true, outbox: true } });
    if (!job) throw new HttpError(404, 'Job not found');
    res.json({ job });
  });
  app.post('/api/jobs/:id/cancel', async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    if (!id.success) throw new HttpError(400, 'Invalid job ID');
    const job = await db.$transaction(async tx => {
      const found = await tx.job.findUnique({ where: { id: id.data } });
      if (!found) throw new HttpError(404, 'Job not found');
      if (found.status === 'cancelled') return found;
      const updated = await tx.job.updateMany({ where: { id: id.data, status: { in: ['queued', 'running'] } }, data: { status: 'cancelled', finishedAt: new Date(), runToken: null } });
      if (!updated.count) throw new HttpError(409, 'Only queued or running jobs can be cancelled');
      await tx.jobEvent.create({ data: { jobId: id.data, kind: 'cancelled', attempt: found.attempts, message: 'Cancellation requested; demo handler stops cooperatively' } });
      return tx.job.findUniqueOrThrow({ where: { id: id.data } });
    });
    res.json({ job });
  });
  app.get('/api/metrics', async (_req, res) => {
    const [counts, deadLetters, pendingDispatch, coordination, durations] = await Promise.all([
      db.job.groupBy({ by: ['status'], _count: true }), db.deadLetter.count(),
      db.outbox.count({ where: { publishedAt: null, job: { status: 'queued' } } }), deps.coordination(),
      db.$queryRaw<{ averageMs: number | null }[]>`SELECT AVG(EXTRACT(EPOCH FROM ("finishedAt" - "startedAt")) * 1000)::float8 AS "averageMs" FROM "Job" WHERE status = 'succeeded' AND "startedAt" IS NOT NULL`,
    ]);
    const states = Object.fromEntries(['queued', 'running', 'succeeded', 'failed', 'cancelled'].map(s => [s, 0]));
    for (const count of counts) states[count.status] = count._count;
    res.json({ states, deadLetters, pendingDispatch, ...coordination, averageDurationMs: durations[0]?.averageMs ?? null });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    const status = typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    if (status === 400 || status === 413) return res.status(status).json({ error: status === 413 ? 'Request too large' : 'Invalid JSON' });
    logger.error({ code: 'REQUEST_FAILED' }, 'request failed');
    res.status(503).json({ error: 'Service temporarily unavailable' });
  });
  return app;
}
