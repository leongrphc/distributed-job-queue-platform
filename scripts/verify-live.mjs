import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Non-destructive acceptance check: creates only a handful of public sample jobs.
const base = process.env.PLAYWRIGHT_BASE_URL;
if (!base) throw new Error('Set PLAYWRIGHT_BASE_URL to the live dashboard');
let cookie = '';
async function request(path, body, extra = {}) {
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(110000),
  });
  return { response, data: await response.json() };
}
const login = await request('/api/session', { demo: true });
assert.equal(login.response.status, 200, JSON.stringify(login.data));
const setCookie = login.response.headers.get('set-cookie');
assert.match(setCookie, /HttpOnly/i);
assert.match(setCookie, /Secure/i);
assert.match(setCookie, /SameSite=strict/i);
cookie = setCookie.split(';')[0];
async function enqueue(body, key = randomUUID()) {
  const result = await request('/api/jobs', body, { 'Idempotency-Key': key });
  assert.equal(result.response.status, 201, JSON.stringify(result.data));
  return { id: result.data.job.id, key };
}
async function wait(id, status) {
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    const result = await request(`/api/jobs/${id}`);
    assert.equal(result.response.status, 200);
    if (result.data.job.status === status) return result.data.job;
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw new Error(`Job ${id} did not reach ${status}`);
}
const echoBody = { type: 'echo', payload: { message: 'Live acceptance check' } };
const echo = await enqueue(echoBody);
const replay = await request('/api/jobs', echoBody, { 'Idempotency-Key': echo.key });
assert.equal(replay.response.status, 200);
assert.equal(replay.data.job.id, echo.id);
assert.equal(replay.data.replayed, true);
assert.equal((await wait(echo.id, 'succeeded')).result.message, echoBody.payload.message);
const sum = await enqueue({ type: 'sum', payload: { numbers: [2, 3, 5] } });
assert.equal((await wait(sum.id, 'succeeded')).result.sum, 10);
const retry = await enqueue({ type: 'flaky', payload: { failuresBeforeSuccess: 1, message: 'retry check' }, backoffMs: 100 });
assert.equal((await wait(retry.id, 'succeeded')).attempts, 2);
const dead = await enqueue({ type: 'flaky', payload: { failuresBeforeSuccess: 3, message: 'dead-letter check' }, maxAttempts: 2, backoffMs: 100 });
assert.ok((await wait(dead.id, 'failed')).deadLetter);
const delayed = await enqueue({ type: 'echo', payload: { message: 'scheduled check' }, runAt: new Date(Date.now() + 5000).toISOString() });
await wait(delayed.id, 'succeeded');
const cancelled = await enqueue({ type: 'sleep', payload: { durationMs: 10000 }, runAt: new Date(Date.now() + 10000).toISOString() });
assert.equal((await request(`/api/jobs/${cancelled.id}/cancel`, {})).response.status, 200);
await wait(cancelled.id, 'cancelled');
const metrics = await request('/api/metrics');
assert.equal(metrics.response.status, 200);
assert.ok(metrics.data.workers > 0 && metrics.data.dispatcher);
console.log('PASS: signed session, echo, sum, idempotency, retry, dead letter, schedule, cancellation, metrics');
