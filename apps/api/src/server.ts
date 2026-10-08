import { createApp } from './app.js';
import { db } from './db.js';
import { config } from './config.js';
import { createRedis, coordination } from './redis.js';
import { RedisRateStore } from './rate-store.js';
import { installShutdown } from './lifecycle.js';
import { logger } from './logger.js';
const redis = createRedis();
const app = createApp({ ping: () => redis.ping(), coordination: () => coordination(redis), rateStore: new RedisRateStore(redis) });
const server = app.listen(config.PORT, '0.0.0.0', () => logger.info({ port: config.PORT }, 'api listening'));
installShutdown(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await Promise.all([db.$disconnect(), redis.quit()]);
});
