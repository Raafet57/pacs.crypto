function sendNotFound(reply, resourceName) {
  return reply.code(404).send({
    error: 'not_found',
    message: `${resourceName} not found.`,
  });
}

export function registerReportingRoutes(app) {
  app.get('/reporting/notifications', async (request) => {
    return app.store.listReportingNotifications(request.query);
  });

  app.get('/reporting/notifications/:notificationId', async (request, reply) => {
    const notification = app.store.getReportingNotification(
      request.params.notificationId,
    );
    if (!notification) {
      return sendNotFound(reply, 'Reporting notification');
    }

    return notification;
  });

  app.get('/reporting/intraday', async (request) => {
    return app.store.getIntradayReportingView(request.query);
  });

  app.get('/reporting/statements', async (request) => {
    return app.store.listReportingStatements(request.query);
  });

  app.get('/reporting/statements/:statementId', async (request, reply) => {
    const statement = app.store.getReportingStatement(request.params.statementId);
    if (!statement) {
      return sendNotFound(reply, 'Reporting statement');
    }

    return statement;
  });
}
