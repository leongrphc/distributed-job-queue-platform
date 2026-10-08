import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
// Never run integration mutations in the configured application database.
const source = new URL(process.env.DATABASE_URL ?? '');
const name = `queue_test_${randomUUID().replaceAll('-', '')}`;
const target = new URL(source); target.pathname = `/${name}`;
const admin = new PrismaClient({ datasources: { db: { url: source.toString() } } });
let child;
let stopping = false;
const env = { ...process.env, DATABASE_URL: target.toString(), QUEUE_PREFIX: name, LOG_LEVEL: 'silent' };
const run = args => new Promise((resolve, reject) => {
  child = spawn(process.execPath, args, { stdio: 'inherit', env });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Check exited with ${code}`)));
});
process.on('SIGTERM', () => { stopping = true; child?.kill('SIGTERM'); });
process.on('SIGINT', () => { stopping = true; child?.kill('SIGTERM'); });
let created = false;
try {
  // Identifier is generated internally from a UUID and contains only letters, digits and underscores.
  await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`); created = true;
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'packages/db/prisma/schema.prisma']);
  if (stopping) throw new Error('Interrupted');
  await run(['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts']);
} catch (error) { console.error(error instanceof Error ? error.message : 'Integration check failed'); process.exitCode = 1; }
finally {
  if (created) await admin.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.$disconnect();
}
