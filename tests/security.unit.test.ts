import { it, expect } from 'vitest';
import { createLogger } from '../apps/api/src/logger.js';
import { boundedBody, BodyTooLarge, sameOrigin } from '../apps/web/lib/proxy.js';
import { NextRequest } from 'next/server';
it('redacts credentials, payloads and raw errors from structured logs', () => {
  const lines: string[] = [];
  const log = createLogger({ write: line => { lines.push(line); } });
  log.info({ token: 'secret-token', password: 'secret-password', payload: { message: 'secret-message' }, req: { headers: { authorization: 'Bearer secret-auth', cookie: 'secret-cookie' }, body: { token: 'secret-body' } }, err: new Error('secret-error') }, 'operational event');
  expect(lines).toHaveLength(1);
  const entry = JSON.parse(lines[0]); expect(entry.payload).toBe('[REDACTED]');
  expect(lines[0]).not.toContain('secret-'); expect(entry.msg).toBe('operational event');
});
it('bounds chunked proxy request bodies without trusting Content-Length', async () => {
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('a'.repeat(2048))); controller.close(); } });
  const req = new NextRequest('http://localhost/api/session', { method: 'POST', body, duplex: 'half' } as RequestInit);
  await expect(boundedBody(req, 1024)).rejects.toBeInstanceOf(BodyTooLarge);
});
it('validates exact browser origin and decodes small bodies', async () => {
  const req = new NextRequest('http://localhost/api/session', { method: 'POST', headers: { origin: 'http://localhost' }, body: '{"ok":true}' });
  expect(sameOrigin(req)).toBe(true); expect(await boundedBody(req, 100)).toBe('{"ok":true}');
  expect(sameOrigin(new NextRequest('http://localhost/api/session', { headers: { origin: 'https://evil.example' } }))).toBe(false);
});

it('accepts a published container port while rejecting a different browser origin', () => {
  const req = new NextRequest('http://web:3000/api/session', { headers: { host: 'localhost:3309', origin: 'http://localhost:3309' } });
  expect(sameOrigin(req)).toBe(true);
  const forged = new NextRequest('http://web:3000/api/session', { headers: { host: 'localhost:3309', origin: 'http://evil.example' } });
  expect(sameOrigin(forged)).toBe(false);
});
