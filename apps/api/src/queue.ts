import { Queue } from 'bullmq';
import { config } from './config.js';
import { createRedis } from './redis.js';
export function createQueues() {
  const connection = createRedis(true);
  const jobs = new Queue<{ jobId: string }>('jobs', { connection, prefix: config.QUEUE_PREFIX });
  const dead = new Queue<{ jobId: string; reason: string }>('dead-letter', { connection, prefix: config.QUEUE_PREFIX });
  return { connection, jobs, dead, async close() { await Promise.all([jobs.close(), dead.close()]); await connection.quit(); } };
}
export type Queues = ReturnType<typeof createQueues>;
