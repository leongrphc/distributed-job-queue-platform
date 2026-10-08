import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('sign in, enqueue, inspect result and sign out', async ({ page, context, request }) => {
  expect((await request.get('/api/jobs')).status()).toBe(401);
  expect((await request.post('/api/session', { headers: { Origin: 'https://evil.example' }, data: { token: process.env.DEMO_API_TOKEN } })).status()).toBe(403);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  if (process.env.PLAYWRIGHT_BASE_URL) {
    await page.getByRole('button', { name: 'Try live demo', exact: true }).click();
  } else {
    await page.getByLabel('Demo token').fill(process.env.DEMO_API_TOKEN!);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Metrics' })).toBeVisible({ timeout: 110000 });
  const session = (await context.cookies()).find(c => c.name === 'demo_session');
  expect(session?.httpOnly).toBe(true); expect(session?.sameSite).toBe('Strict');
  expect(await page.evaluate(() => document.cookie)).not.toContain('demo_session');
  const message = `browser-smoke-${randomUUID()}`;
  await page.getByLabel('Payload (JSON)').fill(JSON.stringify({ message }));
  await page.getByLabel('Idempotency key').fill(randomUUID());
  await page.getByRole('button', { name: 'Enqueue job', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Job accepted');
  const jobId = (await page.getByRole('status').innerText()).split(': ')[1];
  await page.goto(`/jobs/${jobId}`);
  await expect(page.getByTestId('job-state')).toHaveText('succeeded', { timeout: 20000 });
  await expect(page.locator('pre').nth(1)).toContainText(message);
  await expect(page.getByRole('table')).toContainText('running');
  await page.getByRole('link', { name: 'Back to jobs' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Demo sign in' })).toBeVisible();
  expect(errors).toEqual([]);
});
