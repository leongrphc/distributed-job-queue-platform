import 'dotenv/config';
import { it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { config } from '../apps/api/src/config.js';
import { createRedis } from '../apps/api/src/redis.js';
import { RedisRateStore } from '../apps/api/src/rate-store.js';
import { createApp } from '../apps/api/src/app.js';
import { db } from '../apps/api/src/db.js';
const redis = createRedis();
const deps = { ping: () => redis.ping(), coordination: async () => ({ workers: 1, dispatcher: true }) };
afterAll(async () => {
  const keys = await redis.keys(`${config.QUEUE_PREFIX}:rate:*`);
  if (keys.length) await redis.del(...keys);
  await redis.quit(); await db.$disconnect();
});
it('enforces one Redis rate limit across API replicas', async () => {
  const first = createApp({ ...deps, rateStore: new RedisRateStore(redis) });
  const second = createApp({ ...deps, rateStore: new RedisRateStore(redis) });
  for (let i = 0; i < 120; i++) expect((await request(i % 2 ? first : second).get('/api/auth/check')).status).toBe(401);
  const denied = await request(second).get('/api/auth/check');
  expect(denied.status).toBe(429); expect(denied.headers['ratelimit']).toBeDefined();
});
it('rejects malformed/oversized JSON and cannot be authorized by forwarded headers', async () => {
  const app = createApp(deps);
  expect((await request(app).get('/api/jobs').set('X-Forwarded-Authorization', `Bearer ${config.DEMO_API_TOKEN}`)).status).toBe(401);
  expect((await request(app).post('/api/jobs').set('Authorization', `Bearer ${config.DEMO_API_TOKEN}`).set('Content-Type', 'application/json').send('{broken')).status).toBe(400);
  expect((await request(app).post('/api/jobs').set('Authorization', `Bearer ${config.DEMO_API_TOKEN}`).send({ data: 'x'.repeat(40000) })).status).toBe(413);
});
it('reports unavailable dependencies without exposing credentials', async () => {
  const app = createApp({ ...deps, ping: async () => { throw new Error('postgres://secret:password@internal'); } });
  const response = await request(app).get('/ready');
  expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toContain('secret');
});
