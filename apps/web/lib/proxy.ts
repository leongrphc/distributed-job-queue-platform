import { NextRequest, NextResponse } from 'next/server';
export function sameOrigin(req: NextRequest) { return req.headers.get('origin') === req.nextUrl.origin; }
export const apiUrl = () => process.env.API_URL ?? 'http://localhost:4000';
export async function upstream(path: string, init: RequestInit) {
  return fetch(`${apiUrl()}${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(5000) });
}
export function unavailable() { return NextResponse.json({ error: 'API unavailable' }, { status: 503 }); }
