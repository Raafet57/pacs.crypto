import Fastify from 'fastify';

import { ReferenceStore } from './db.js';
import { registerEventRoutes } from './routes/event-routes.js';
import { registerHealthRoutes } from './routes/health-routes.js';
import { registerInstructionRoutes } from './routes/instruction-routes.js';
import { registerReportingRoutes } from './routes/reporting-routes.js';
import { registerStatusRoutes } from './routes/status-routes.js';
import { registerTravelRuleRoutes } from './routes/travel-rule-routes.js';
import { registerWebhookRoutes } from './routes/webhook-routes.js';

async function defaultWebhookSender({ url, headers, body }) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  return {
    status: response.status,
    bodyText: await response.text(),
  };
}

export async function buildApp({
  dbPath = ':memory:',
  webhookSender = defaultWebhookSender,
} = {}) {
  const app = Fastify({ logger: false });
  const store = new ReferenceStore({ dbPath });

  app.decorate('store', store);
  app.decorate('webhookSender', webhookSender);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('access-control-allow-origin', '*');
    reply.header(
      'access-control-allow-methods',
      'GET,POST,PUT,DELETE,OPTIONS',
    );
    reply.header(
      'access-control-allow-headers',
      'content-type, authorization',
    );

    if (request.method === 'OPTIONS') {
      reply.code(204).send();
    }
  });

  app.addHook('onClose', async () => {
    store.close();
  });

  registerHealthRoutes(app);
  registerTravelRuleRoutes(app);
  registerInstructionRoutes(app);
  registerStatusRoutes(app);
  registerEventRoutes(app);
  registerWebhookRoutes(app);
  registerReportingRoutes(app);

  return app;
}
