import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createDemoSession,
  DEMO_SESSION_MAX_AGE,
  isSignedDemoSession,
  verifyDemoSession,
} from '../apps/web/lib/demo-session';
import { sessionToken } from '../apps/web/lib/proxy';

const secret = 'demo-session-test-secret-with-at-least-32-chars';
const backendToken = 'backend-demo-token-that-must-not-leak';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('demo sessions', () => {
  it('verifies a session signed with the configured secret', () => {
    vi.stubEnv('DEMO_SESSION_SECRET', secret);

    const session = createDemoSession(1_700_000_000);

    expect(isSignedDemoSession(session)).toBe(true);
    expect(verifyDemoSession(session, 1_700_000_000)).toBe(true);
  });

  it('rejects a tampered session', () => {
    vi.stubEnv('DEMO_SESSION_SECRET', secret);
    const session = createDemoSession(1_700_000_000);
    const parts = session.split('.');
    parts[2] = `${parts[2]}x`;

    expect(verifyDemoSession(parts.join('.'), 1_700_000_000)).toBe(false);
  });

  it('rejects an expired session', () => {
    vi.stubEnv('DEMO_SESSION_SECRET', secret);
    const issuedAt = 1_700_000_000;
    const session = createDemoSession(issuedAt);

    expect(verifyDemoSession(session, issuedAt + DEMO_SESSION_MAX_AGE)).toBe(false);
  });

  it('rejects a session under a different secret', () => {
    vi.stubEnv('DEMO_SESSION_SECRET', secret);
    const session = createDemoSession(1_700_000_000);
    vi.stubEnv('DEMO_SESSION_SECRET', 'another-demo-session-secret-with-32-chars');

    expect(verifyDemoSession(session, 1_700_000_000)).toBe(false);
  });

  it('does not include the backend token in the signed session', () => {
    vi.stubEnv('DEMO_SESSION_SECRET', secret);
    vi.stubEnv('DEMO_API_TOKEN', backendToken);

    const session = createDemoSession(1_700_000_000);

    expect(session).not.toContain(backendToken);
    expect(session).not.toContain('DEMO_API_TOKEN');
  });

  it('does not resolve an invalid signed-looking cookie as a raw token', () => {
    vi.stubEnv('DEMO_SESSION_SECRET', secret);
    vi.stubEnv('DEMO_API_TOKEN', backendToken);
    const invalidSignedLookingValue = 'v1.not-a-valid-expiry.not-a-valid-nonce.not-a-valid-mac';
    const request = new NextRequest('http://localhost/api/jobs', {
      headers: { cookie: `demo_session=${invalidSignedLookingValue}` },
    });

    expect(isSignedDemoSession(invalidSignedLookingValue)).toBe(true);
    expect(sessionToken(request)).toBeUndefined();
  });
});
