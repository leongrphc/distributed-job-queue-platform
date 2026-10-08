import { spawn } from 'node:child_process';
const webPort = Number(process.env.WEB_PORT ?? 3000);
const apiPort = Number(process.env.PORT ?? 4000);
if (![webPort, apiPort].every(p => Number.isInteger(p) && p > 0 && p < 65536)) throw new Error('Invalid ports');
const children = [
  ['apps/api/dist/server.js'], ['apps/api/dist/dispatcher.js'], ['apps/api/dist/worker.js'],
  ['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', String(webPort)],
].map(args => spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, API_URL: `http://localhost:${apiPort}` } }));
let stopping = false;
function stop(code) {
  if (stopping) return; stopping = true;
  const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); process.exit(1); }, 32000);
  let remaining = children.filter(c => c.exitCode === null && c.signalCode === null).length;
  if (!remaining) { clearTimeout(timer); process.exit(code); }
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.once('exit', () => { if (--remaining === 0) { clearTimeout(timer); process.exit(code); } });
    child.kill('SIGTERM');
  }
}
process.on('SIGINT', () => stop(0)); process.on('SIGTERM', () => stop(0));
for (const child of children) { child.on('error', () => stop(1)); child.on('exit', () => { if (!stopping) stop(1); }); }
