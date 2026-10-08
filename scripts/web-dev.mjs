import { spawn } from 'node:child_process';
const port = Number(process.env.WEB_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WEB_PORT');
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', 'apps/web', '--hostname', '0.0.0.0', '--port', String(port), ...process.argv.slice(2)], { stdio: 'inherit' });
process.once('SIGINT', () => child.kill('SIGINT'));
process.once('SIGTERM', () => child.kill('SIGTERM'));
child.once('error', () => { process.exitCode = 1; });
child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
