import { NextRequest, NextResponse } from 'next/server';
import { clientIp, sameOrigin, upstream, unavailable, boundedBody, BodyTooLarge, GatewayError, sessionToken } from '../../../lib/proxy';
export const maxDuration = 120;
async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  if (req.method !== 'GET' && !sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const token = sessionToken(req);
  if (!token) return NextResponse.json({ error: 'Sign in with the demo token' }, { status: 401 });
  const path = (await context.params).path.join('/');
  if (!/^(jobs|jobs\/[0-9a-f-]{36}|jobs\/[0-9a-f-]{36}\/cancel|metrics|ready)$/.test(path)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (req.method === 'POST' && !/^(jobs|jobs\/[0-9a-f-]{36}\/cancel)$/.test(path)) return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
  if (Number(req.headers.get('content-length') ?? 0) > 32768) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const key = req.headers.get('idempotency-key'); if (key) headers['Idempotency-Key'] = key;
    const response = await upstream(`${path === 'ready' ? '/ready' : `/api/${path}`}${req.nextUrl.search}`, { method: req.method, headers, ...(req.method === 'POST' ? { body: await boundedBody(req, 32768) } : {}) }, clientIp(req));
    const body = await response.text();
    const result = new NextResponse(body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    for (const name of ['ratelimit', 'ratelimit-policy', 'retry-after', 'x-request-id']) { const value = response.headers.get(name); if (value) result.headers.set(name, value); }
    return result;
  } catch (error) {
    if (error instanceof BodyTooLarge) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    if (error instanceof GatewayError) return unavailable();
    return unavailable();
  }
}
export const GET = proxy;
export const POST = proxy;
