import net from 'node:net';
import process from 'node:process';
import { spawn } from 'node:child_process';

const ROOT = new URL('..', import.meta.url);
const REDIS_URL = 'redis://127.0.0.1:6379';
const NODE_OPTIONS = [process.env.NODE_OPTIONS, '--max-old-space-size=96'].filter(Boolean).join(' ');
const children = new Map();
let shuttingDown = false;
let shutdownPromise;
let forceShutdownTimer;

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  });
  children.set(name, child);
  child.once('error', error => {
    if (!shuttingDown) {
      console.error(`${name} failed to start: ${error.message}`);
      void shutdown(1);
    }
  });
  child.once('exit', (code, signal) => {
    children.delete(name);
    if (!shuttingDown) {
      console.error(`${name} exited unexpectedly (${signal ?? `code ${code}`})`);
      void shutdown(1);
    }
  });
  return child;
}

function waitForTcp(host, port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.createConnection({ host, port });
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (!error) return resolve();
        if (Date.now() >= deadline) return reject(new Error(`Redis did not become ready: ${error.message}`));
        setTimeout(attempt, 100);
      };
      socket.once('connect', () => finish());
      socket.once('error', finish);
      socket.setTimeout(1000, () => finish(new Error('connection timeout')));
    };
    attempt();
  });
}

function runMigration() {
  const migrationEnv = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL_UNPOOLED,
    REDIS_URL,
    NODE_ENV: 'production',
    NODE_OPTIONS,
  };
  if (!migrationEnv.DATABASE_URL_UNPOOLED) {
    return Promise.reject(new Error('DATABASE_URL_UNPOOLED is required for migrations'));
  }
  return new Promise((resolve, reject) => {
    const migration = spawn(process.execPath, [
      'node_modules/prisma/build/index.js', 'migrate', 'deploy',
      '--schema', 'packages/db/prisma/schema.prisma',
    ], { cwd: ROOT, env: migrationEnv, stdio: 'inherit' });
    children.set('migration', migration);
    migration.once('close', () => children.delete('migration'));
    migration.once('error', reject);
    migration.once('exit', (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`database migration failed (${signal ?? `code ${code}`})`));
    });
  });
}

function terminate(name) {
  const child = children.get(name);
  if (child && !child.killed) child.kill('SIGTERM');
}

async function stop(name, timeoutMs = 25000) {
  const child = children.get(name);
  if (!child) return;
  terminate(name);
  await new Promise(resolve => {
    let timer;
    const done = () => { clearTimeout(timer); resolve(); };
    if (child.exitCode !== null || child.signalCode !== null) return done();
    child.once('exit', done);
    timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      done();
    }, timeoutMs);
  });
}

async function shutdown(code) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  forceShutdownTimer = setTimeout(() => {
    for (const child of children.values()) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    process.exit(code);
  }, 25000);
  shutdownPromise = (async () => {
    await stop('migration');
    // Stop dispatch first; leave the worker time to drain its active job.
    await stop('dispatcher');
    await Promise.all([stop('api'), stop('worker')]);
    await stop('redis');
    clearTimeout(forceShutdownTimer);
    process.exitCode = code;
  })();
  return shutdownPromise;
}

process.once('SIGTERM', () => void shutdown(0));
process.once('SIGINT', () => void shutdown(0));

async function main() {
  start('redis', 'redis-server', [
    '--bind', '127.0.0.1', '--port', '6379', '--save', '', '--appendonly', 'no',
    '--maxmemory', '64mb', '--maxmemory-policy', 'noeviction', '--protected-mode', 'yes',
  ]);
  await waitForTcp('127.0.0.1', 6379);
  if (shuttingDown) return;
  await runMigration();
  if (shuttingDown) return;

  const runtimeEnv = {
    ...process.env,
    REDIS_URL,
    NODE_ENV: 'production',
    NODE_OPTIONS,
  };
  if (shuttingDown) return;
  start('api', process.execPath, ['apps/api/dist/server.js'], runtimeEnv);
  start('dispatcher', process.execPath, ['apps/api/dist/dispatcher.js'], runtimeEnv);
  start('worker', process.execPath, ['apps/api/dist/worker.js'], runtimeEnv);
}

main().catch(error => {
  console.error(`Render stack startup failed: ${error.message}`);
  void shutdown(1);
});
