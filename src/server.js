import { loadConfig, makeLogger } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

let config;
try { config = loadConfig(); } catch (e) { console.error('FATAL: ' + e.message); process.exit(1); }
const log = makeLogger(config.logLevel);
const db = openDb(config.dataDir, log);
const app = createApp({ db, config, log });
app.locals.seedAdmin();

const server = app.listen(config.port, '0.0.0.0', () => log.info(`finance-hub ${config.version} listening on ${config.port}`));
server.keepAliveTimeout = 65_000;

// Stop accepting, let in-flight requests finish, close SQLite, exit well inside 10 s.
let stopping = false;
function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  log.info(`${sig} received, shutting down`);
  const force = setTimeout(() => { log.warn('forced exit after timeout'); process.exit(1); }, 8000);
  force.unref();
  server.close(() => {
    try { db.close(); } catch (e) { log.error('db close failed', { err: e.message }); }
    log.info('stopped cleanly');
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
