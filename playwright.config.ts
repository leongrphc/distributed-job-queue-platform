import 'dotenv/config';
import { defineConfig } from '@playwright/test';
const webPort = Number(process.env.WEB_PORT ?? 3000);
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 30000,
  use: { baseURL: `http://localhost:${webPort}`, headless: true, trace: 'retain-on-failure' },
  webServer: process.env.SMOKE_EXTERNAL === 'true' ? undefined : { command: 'node --env-file-if-exists=.env scripts/smoke-stack.mjs', url: `http://localhost:${webPort}`, reuseExistingServer: false, timeout: 60000 },
});
