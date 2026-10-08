import { randomUUID } from 'node:crypto';
import { Worker } from 'bullmq';
import { config } from './config.js';
import { createRedis } from './redis.js';
import { processJob } from './processor.js';
import { logger } from './logger.js';
import { db } from './db.js';
import { installShutdown } from './lifecycle.js';
const connection = createRedis(true);
const heartbeatRedis = createRedis();
const workerId = randomUUID();
const worker = new Worker('jobs', processJob, { connection, prefix: config.QUEUE_PREFIX, concurrency: config.WORKER_CONCURRENCY, lockDuration: config.WORKER_LOCK_MS, stalledInterval: config.STALLED_INTERVAL_MS, maxStalledCount: 2 });
worker.on('error', () => logger.error({ code: 'WORKER_ERROR' }, 'worker error'));
worker.on('stalled', jobId => { logger.warn({ jobId, event: 'stalled' }, 'expired lease recovered'); });
worker.on('failed', job => { logger.warn({ jobId: job?.id, event: 'failed' }, 'queue attempt failed'); });
let stopping = false;
let heartbeatTask: Promise<void> = Promise.resolve();
let heartbeatRunning = false;
const beat = () => {
  if (heartbeatRunning || stopping) return;
  heartbeatRunning = true;
  heartbeatTask = (async () => {
    try {
      if (worker.isRunning() && !stopping) {
        await db.$queryRaw`SELECT 1`;
        await heartbeatRedis.zadd(`${config.QUEUE_PREFIX}:workers`, Date.now(), workerId);
      }
    } catch { logger.warn({ code: 'WORKER_HEARTBEAT_FAILED' }, 'worker heartbeat failed'); }
    finally { heartbeatRunning = false; }
  })();
};
beat();
const heartbeat = setInterval(beat, 5000);
logger.info({ workerId, concurrency: config.WORKER_CONCURRENCY }, 'worker started');
installShutdown(async () => {
  stopping = true; clearInterval(heartbeat); await heartbeatTask;
  await worker.close();
  await heartbeatRedis.zrem(`${config.QUEUE_PREFIX}:workers`, workerId);
  await Promise.all([connection.quit(), heartbeatRedis.quit(), db.$disconnect()]);
});
