import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';
export const DEMO_SESSION_MAX_AGE = 60 * 60;

function secret() {
  const value = process.env.DEMO_SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('DEMO_SESSION_SECRET must be at least 32 characters');
  return value;
}

function mac(value: string) {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export function createDemoSession(now = Math.floor(Date.now() / 1000)) {
  const payload = `${VERSION}.${now + DEMO_SESSION_MAX_AGE}.${randomBytes(18).toString('base64url')}`;
  return `${payload}.${mac(payload)}`;
}

export function isSignedDemoSession(value: string | undefined) {
  return value?.startsWith(`${VERSION}.`) ?? false;
}

export function verifyDemoSession(value: string | undefined, now = Math.floor(Date.now() / 1000)) {
  if (!value || !isSignedDemoSession(value)) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return false;
  const expiry = Number(parts[1]);
  if (!Number.isSafeInteger(expiry) || expiry <= now || expiry > now + DEMO_SESSION_MAX_AGE) return false;
  const expected = Buffer.from(mac(parts.slice(0, 3).join('.')));
  const actual = Buffer.from(parts[3]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
