import { logger } from './logger.js';
export function installShutdown(close: () => Promise<void>) {
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    logger.info({ event: 'shutdown' }, 'graceful shutdown started');
    const deadline = setTimeout(() => { logger.error({ code: 'SHUTDOWN_TIMEOUT' }, 'shutdown timed out'); process.exit(1); }, 30000);
    try { await close(); clearTimeout(deadline); process.exit(0); }
    catch { logger.error({ code: 'SHUTDOWN_FAILED' }, 'shutdown failed'); process.exit(1); }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
