import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { isSignedDemoSession, verifyDemoSession } from './demo-session';

export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  if (process.env.WEB_ORIGIN) return origin === process.env.WEB_ORIGIN;
  try { const parsed = new URL(origin); return parsed.origin === origin && parsed.protocol === req.nextUrl.protocol && parsed.host === (req.headers.get('host') ?? req.nextUrl.host); } catch { return false; }
}
export const apiUrl = () => process.env.API_URL ?? 'http://localhost:4000';

export class GatewayError extends Error {}
export function clientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-vercel-forwarded-for');
  if (forwarded) {
    const candidate = forwarded.split(',')[0].trim();
    if (isIP(candidate)) return candidate;
  }
  if (process.env.API_GATEWAY_SECRET && process.env.VERCEL) throw new GatewayError('Missing platform client IP');
  return '127.0.0.1';
}

export function sessionToken(req: NextRequest) {
  const value = req.cookies.get('demo_session')?.value;
  if (!value) return undefined;
  if (isSignedDemoSession(value)) {
    try { return verifyDemoSession(value) ? process.env.DEMO_API_TOKEN : undefined; } catch { return undefined; }
  }
  return value;
}

export async function upstream(path: string, init: RequestInit, ip = '127.0.0.1') {
  const headers = new Headers(init.headers);
  if (process.env.API_GATEWAY_SECRET) headers.set('x-queue-gateway-secret', process.env.API_GATEWAY_SECRET);
  headers.set('x-queue-client-ip', ip);
  const timeout = (init.method ?? 'GET').toUpperCase() === 'GET' ? 90000 : 5000;
  return fetch(`${apiUrl()}${path}`, { ...init, headers, cache: 'no-store', signal: AbortSignal.timeout(timeout) });
}
export function unavailable() { return NextResponse.json({ error: 'API unavailable' }, { status: 503 }); }
export class BodyTooLarge extends Error {}
export async function boundedBody(req: NextRequest, limit: number) {
  if (Number(req.headers.get('content-length') ?? 0) > limit) throw new BodyTooLarge();
  if (!req.body) return '';
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > limit) { await reader.cancel(); throw new BodyTooLarge(); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}
