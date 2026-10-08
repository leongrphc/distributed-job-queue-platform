import { NextRequest, NextResponse } from 'next/server';
import { sameOrigin, upstream, unavailable, boundedBody, BodyTooLarge } from '../../../lib/proxy';
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  if (Number(req.headers.get('content-length') ?? 0) > 1024) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
  try {
    const body: unknown = JSON.parse(await boundedBody(req, 1024));
    const token = body && typeof body === 'object' && 'token' in body ? body.token : undefined;
    if (typeof token !== 'string' || token.length < 16 || token.length > 256) return NextResponse.json({ error: 'Invalid demo token' }, { status: 400 });
    const check = await upstream('/api/auth/check', { headers: { Authorization: `Bearer ${token}` } });
    if (!check.ok) return NextResponse.json({ error: check.status === 429 ? 'Too many attempts. Try again later.' : 'Invalid demo token' }, { status: check.status });
    const res = NextResponse.json({ authorized: true });
    res.cookies.set('demo_session', token, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 3600 });
    return res;
  } catch (error) {
    if (error instanceof BodyTooLarge) return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    return unavailable();
  }
}
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const res = NextResponse.json({ authorized: false });
  res.cookies.set('demo_session', '', { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: 0 });
  return res;
}
