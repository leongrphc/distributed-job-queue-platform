import { randomUUID } from 'node:crypto';
import { createQueues } from './queue.js';
import { createRedis } from './redis.js';
import { createDispatcher } from './dispatch.js';
import { db } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { installShutdown } from './lifecycle.js';
import { runDemoMaintenance } from './demo-maintenance.js';
const queues = createQueues();
const redis = createRedis();
const dispatch = createDispatcher(queues);
const owner = randomUUID();
let stopping = false;
let wake: (() => void) | undefined;
let lastMaintenance = 0;
const loop = (async () => {
  while (!stopping) {
    try {
      if (config.DEMO_RETENTION_HOURS > 0 && Date.now() - lastMaintenance >= 60000) {
        lastMaintenance = Date.now();
        await runDemoMaintenance({ jobs: queues.jobs, dead: queues.dead });
      }
      await dispatch(); await redis.set(`${config.QUEUE_PREFIX}:dispatcher`, owner, 'PX', 15000);
    }
    catch { logger.error({ code: 'DISPATCH_FAILED' }, 'dispatch iteration failed'); }
    if (!stopping) await new Promise<void>(resolve => { const timer = setTimeout(resolve, 500); wake = () => { clearTimeout(timer); resolve(); }; });
  }
})();
logger.info({ role: 'dispatcher' }, 'dispatcher started');
installShutdown(async () => {
  stopping = true; wake?.(); await loop;
  await redis.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end", 1, `${config.QUEUE_PREFIX}:dispatcher`, owner);
  await queues.close(); await Promise.all([redis.quit(), db.$disconnect()]);
});
