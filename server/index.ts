import app from './app.ts';
import { appUrl, port, production } from './config.ts';
import { db } from './store.ts';
import { processQueue } from './calendar.ts';
if (!production) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: { port: port + 1 } }, appType: 'spa' });
  app.use(vite.middlewares);
}
const host = process.env.HOST || (production ? '0.0.0.0' : '127.0.0.1');
const server = app.listen(port, host, () => console.log(`Fokus läuft auf ${appUrl}`));
const timer = process.env.DATABASE_URL ? null : setInterval(() => { void processQueue(); }, 60000);
timer?.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { if (timer) clearInterval(timer); server.close(() => { db.close(); process.exit(0); }); });
