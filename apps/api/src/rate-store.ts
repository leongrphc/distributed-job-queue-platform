import type { Store, Options } from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { config } from './config.js';
// All API replicas share one atomic rate limit. Hash IP identifiers before storage.
export class RedisRateStore implements Store {
  private windowMs = 60000;
  constructor(private redis: Redis) {}
  init(options: Options) { this.windowMs = options.windowMs; }
  private key(key: string) { return `${config.QUEUE_PREFIX}:rate:${createHash('sha256').update(key).digest('hex')}`; }
  async increment(key: string) {
    const result = await this.redis.eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; return {n, redis.call('PTTL', KEYS[1])}", 1, this.key(key), this.windowMs) as number[];
    return { totalHits: result[0], resetTime: new Date(Date.now() + Math.max(0, result[1])) };
  }
  async decrement(key: string) { await this.redis.eval("if redis.call('EXISTS', KEYS[1]) == 1 then redis.call('DECR', KEYS[1]) end", 1, this.key(key)); }
  async resetKey(key: string) { await this.redis.del(this.key(key)); }
}
