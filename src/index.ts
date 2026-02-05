import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from './config';
import { logger } from './lib/logger';
import { balanceRoutes } from './routes/balance';
import { transactionRoutes } from './routes/transactions';
import { payoutRoutes } from './routes/payouts';
import { fundingRoutes } from './routes/funding';
import { publisher } from './lib/events';
import { setupEventHandlers, stopEventHandlers } from './events/handlers';

async function main() {
  const app = Fastify({
    logger: logger as any,
  });

  // Plugins
  await app.register(cors, {
    origin: config.allowedOrigins,
    credentials: true,
  });
  await app.register(helmet);

  // Health check
  app.get('/health', async () => ({ status: 'ok', service: 'financial-service' }));
  app.get('/ready', async () => {
    // Could add DB connectivity check here
    return { status: 'ready', service: 'financial-service' };
  });

  // Routes
  await app.register(balanceRoutes, { prefix: '/balance' });
  await app.register(transactionRoutes, { prefix: '/transactions' });
  await app.register(payoutRoutes, { prefix: '/payouts' });
  await app.register(fundingRoutes, { prefix: '/funding' });

  // Connect event publisher
  await publisher.connect();

  // Start event handlers (consumer)
  await setupEventHandlers();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await stopEventHandlers();
    await publisher.disconnect();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Start server
  await app.listen({ port: config.port, host: config.host });
  logger.info(`Financial service listening on ${config.host}:${config.port}`);
}

main().catch((err) => {
  logger.error(err, 'Failed to start financial service');
  process.exit(1);
});
