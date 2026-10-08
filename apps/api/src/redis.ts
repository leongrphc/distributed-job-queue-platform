import { Redis } from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';
export function createRedis(blocking = false) {
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: blocking ? null : 1, ...(blocking ? {} : { commandTimeout: 3000 }), connectTimeout: 3000 });
  redis.on('error', () => logger.warn({ code: 'REDIS_UNAVAILABLE' }, 'redis connection unavailable'));
  return redis;
}
export async function coordination(redis: Redis) {
  const cutoff = Date.now() - 15000;
  await redis.zremrangebyscore(`${config.QUEUE_PREFIX}:workers`, '-inf', cutoff);
  const [workers, dispatcher] = await Promise.all([redis.zcard(`${config.QUEUE_PREFIX}:workers`), redis.exists(`${config.QUEUE_PREFIX}:dispatcher`)]);
  return { workers, dispatcher: Boolean(dispatcher) };
}
