import type { Queue } from 'bullmq';
import { db } from './db.js';
import { config } from './config.js';

type QueueLike = Pick<Queue, 'getJob'>;
type TerminalStatus = 'succeeded' | 'failed' | 'cancelled';

export interface DemoMaintenanceDependencies {
  jobs: QueueLike;
  dead: QueueLike;
  database?: typeof db;
  now?: () => Date;
}

/** Remove expired terminal demo records, retaining Redis safety over cleanup. */
export async function runDemoMaintenance(deps: DemoMaintenanceDependencies): Promise<number> {
  if (config.DEMO_RETENTION_HOURS <= 0) return 0;
  const database = deps.database ?? db;
  const cutoff = new Date((deps.now ?? (() => new Date()))().getTime() - config.DEMO_RETENTION_HOURS * 60 * 60 * 1000);
  const jobs = await database.job.findMany({
    where: { status: { in: ['succeeded', 'failed', 'cancelled'] as TerminalStatus[] }, finishedAt: { lt: cutoff } },
    orderBy: { finishedAt: 'asc' }, take: 100,
    select: { id: true },
  });
  let removed = 0;
  for (const row of jobs) {
    let safe = true;
    for (const queue of [deps.jobs, deps.dead]) {
      const queueJob = await queue.getJob(row.id);
      if (!queueJob) continue;
      try {
        if (await queueJob.getState() === 'active') { safe = false; break; }
        await queueJob.remove();
      } catch {
        safe = false;
        break;
      }
    }
    if (!safe) continue;
    const result = await database.job.deleteMany({
      where: { id: row.id, status: { in: ['succeeded', 'failed', 'cancelled'] }, finishedAt: { lt: cutoff } },
    });
    removed += result.count;
  }
  return removed;
}

