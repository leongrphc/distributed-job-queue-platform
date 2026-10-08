import 'dotenv/config';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../apps/api/src/app.js';
import { db } from '../apps/api/src/db.js';
const app = createApp({ ping: async () => 'PONG', coordination: async () => ({ workers: 1, dispatcher: true }) });
const auth = `Bearer ${process.env.DEMO_API_TOKEN}`;
const ids: string[] = [];
beforeAll(async () => { await db.$connect(); });
afterAll(async () => { await db.job.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); });
describe('database API', () => {
  it('requires auth and validates payloads', async () => {
    expect((await request(app).get('/api/jobs')).status).toBe(401);
    expect((await request(app).post('/api/jobs').set('Authorization', auth).send({ type: 'echo', payload: { secret: 'no' } })).status).toBe(400);
  });
  it('creates one durable job under concurrent idempotent requests', async () => {
    const key = randomUUID();
    const input = { type: 'echo', payload: { message: 'api-test' } };
    const responses = await Promise.all(Array.from({ length: 5 }, () => request(app).post('/api/jobs').set('Authorization', auth).set('Idempotency-Key', key).send(input)));
    expect(responses.filter(r => r.status === 201)).toHaveLength(1);
    expect(responses.filter(r => r.status === 200)).toHaveLength(4);
    const id = responses[0].body.job.id; ids.push(id);
    expect(new Set(responses.map(r => r.body.job.id)).size).toBe(1);
    expect(await db.outbox.count({ where: { jobId: id } })).toBe(1);
    const conflict = await request(app).post('/api/jobs').set('Authorization', auth).set('Idempotency-Key', key).send({ ...input, payload: { message: 'other' } });
    expect(conflict.status).toBe(409);
    const detail = await request(app).get(`/api/jobs/${id}`).set('Authorization', auth);
    expect(detail.body.job.history[0].kind).toBe('queued');
    const cancelled = await request(app).post(`/api/jobs/${id}/cancel`).set('Authorization', auth);
    expect(cancelled.body.job.status).toBe('cancelled');
    expect((await request(app).post(`/api/jobs/${id}/cancel`).set('Authorization', auth)).status).toBe(200);
    const listing = await request(app).get('/api/jobs?status=cancelled&pageSize=1').set('Authorization', auth);
    expect(listing.body.jobs).toHaveLength(1);
    expect((await request(app).get('/api/jobs?pageSize=500').set('Authorization', auth)).status).toBe(400);
  });
  it('reports metrics and readiness', async () => {
    expect((await request(app).get('/ready')).status).toBe(200);
    const metrics = await request(app).get('/api/metrics').set('Authorization', auth);
    expect(metrics.status).toBe(200);
    expect(metrics.body.states).toHaveProperty('queued');
    const waiting = createApp({ ping: async () => 'PONG', coordination: async () => ({ workers: 0, dispatcher: false }) });
    expect((await request(waiting).get('/ready')).status).toBe(503);
  });
});
