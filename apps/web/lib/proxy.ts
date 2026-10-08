import { NextRequest, NextResponse } from 'next/server';
export function sameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  if (process.env.WEB_ORIGIN) return origin === process.env.WEB_ORIGIN;
  try {
    const parsed = new URL(origin);
    return parsed.origin === origin && parsed.protocol === req.nextUrl.protocol && parsed.host === (req.headers.get('host') ?? req.nextUrl.host);
  } catch { return false; }
}
export const apiUrl = () => process.env.API_URL ?? 'http://localhost:4000';
export async function upstream(path: string, init: RequestInit) {
  return fetch(`${apiUrl()}${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(5000) });
}
export function unavailable() { return NextResponse.json({ error: 'API unavailable' }, { status: 503 }); }
export class BodyTooLarge extends Error {}
export async function boundedBody(req: NextRequest, limit: number) {
  if (Number(req.headers.get('content-length') ?? 0) > limit) throw new BodyTooLarge();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new BodyTooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}
