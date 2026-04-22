function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const WEBHOOK_EVENT_TYPES = new Set([
  'execution_status.updated',
  'finality_receipt.updated',
  'reporting_notification.created',
]);

function validateRequiredField(errors, condition, field, message) {
  if (!condition) {
    errors.push({ field, message });
  }
}

export function validateQuoteRequest(body) {
  const errors = [];
  validateRequiredField(errors, isObject(body), 'body', 'Request body must be a JSON object.');
  if (errors.length) {
    return errors;
  }

  validateRequiredField(errors, isObject(body.token), 'token', 'token is required.');
  validateRequiredField(errors, hasText(body.chain_dli), 'chain_dli', 'chain_dli is required.');
  validateRequiredField(errors, hasText(body.amount), 'amount', 'amount is required.');
  validateRequiredField(errors, hasText(body.currency), 'currency', 'currency is required.');
  validateRequiredField(errors, hasText(body.custody_model), 'custody_model', 'custody_model is required.');
  return errors;
}

export function validateInstructionSubmission(body) {
  const errors = [];
  validateRequiredField(errors, isObject(body), 'body', 'Request body must be a JSON object.');
  if (errors.length) {
    return errors;
  }

  validateRequiredField(
    errors,
    hasText(body.payment_identification?.end_to_end_identification),
    'payment_identification.end_to_end_identification',
    'end_to_end_identification is required.',
  );
  validateRequiredField(
    errors,
    hasText(body.interbank_settlement_amount?.amount),
    'interbank_settlement_amount.amount',
    'interbank_settlement_amount.amount is required.',
  );
  validateRequiredField(
    errors,
    hasText(body.interbank_settlement_amount?.currency),
    'interbank_settlement_amount.currency',
    'interbank_settlement_amount.currency is required.',
  );
  validateRequiredField(
    errors,
    isObject(body.blockchain_instruction?.token),
    'blockchain_instruction.token',
    'blockchain_instruction.token is required.',
  );
  validateRequiredField(
    errors,
    hasText(body.blockchain_instruction?.chain_dli),
    'blockchain_instruction.chain_dli',
    'blockchain_instruction.chain_dli is required.',
  );
  validateRequiredField(
    errors,
    hasText(body.blockchain_instruction?.custody_model),
    'blockchain_instruction.custody_model',
    'blockchain_instruction.custody_model is required.',
  );

  return errors;
}

export function validateTravelRuleSubmission(body) {
  const errors = [];
  validateRequiredField(errors, isObject(body), 'body', 'Request body must be a JSON object.');
  if (errors.length) {
    return errors;
  }

  const data = body.travel_rule_data;
  validateRequiredField(errors, isObject(data), 'travel_rule_data', 'travel_rule_data is required.');
  if (!isObject(data)) {
    return errors;
  }

  validateRequiredField(errors, hasText(data.debtor?.name), 'travel_rule_data.debtor.name', 'Debtor name is required.');
  validateRequiredField(errors, hasText(data.creditor?.name), 'travel_rule_data.creditor.name', 'Creditor name is required.');
  validateRequiredField(
    errors,
    hasText(data.debtor_account?.proxy?.identification),
    'travel_rule_data.debtor_account.proxy.identification',
    'Debtor wallet address is required.',
  );
  validateRequiredField(
    errors,
    hasText(data.creditor_account?.proxy?.identification),
    'travel_rule_data.creditor_account.proxy.identification',
    'Creditor wallet address is required.',
  );
  validateRequiredField(
    errors,
    hasText(data.payment_identification?.end_to_end_identification),
    'travel_rule_data.payment_identification.end_to_end_identification',
    'payment_identification.end_to_end_identification is required.',
  );

  return errors;
}

export function validateTravelRuleCallback(body) {
  const errors = [];
  validateRequiredField(errors, isObject(body), 'body', 'Request body must be a JSON object.');
  if (errors.length) {
    return errors;
  }

  validateRequiredField(
    errors,
    hasText(body.callback_status),
    'callback_status',
    'callback_status is required.',
  );

  if (body.callback_status === 'REJECTED') {
    validateRequiredField(
      errors,
      Array.isArray(body.rejection_reasons) && body.rejection_reasons.length > 0,
      'rejection_reasons',
      'rejection_reasons is required for REJECTED callbacks.',
    );
  }

  return errors;
}

export function validateTravelRuleStatsQuery(query) {
  const errors = [];
  validateRequiredField(
    errors,
    hasText(query.submitted_from),
    'submitted_from',
    'submitted_from is required for stats queries.',
  );
  validateRequiredField(
    errors,
    hasText(query.submitted_to),
    'submitted_to',
    'submitted_to is required for stats queries.',
  );
  return errors;
}

export function validateWebhookSubscriptionSubmission(body) {
  const errors = [];
  validateRequiredField(errors, isObject(body), 'body', 'Request body must be a JSON object.');
  if (errors.length) {
    return errors;
  }

  validateRequiredField(errors, hasText(body.url), 'url', 'url is required.');
  validateRequiredField(
    errors,
    hasText(body.signing_secret),
    'signing_secret',
    'signing_secret is required.',
  );

  if (
    body.subscribed_event_types !== undefined &&
    !Array.isArray(body.subscribed_event_types)
  ) {
    errors.push({
      field: 'subscribed_event_types',
      message: 'subscribed_event_types must be an array when provided.',
    });
  }

  if (Array.isArray(body.subscribed_event_types)) {
    for (const eventType of body.subscribed_event_types) {
      if (!WEBHOOK_EVENT_TYPES.has(eventType)) {
        errors.push({
          field: 'subscribed_event_types',
          message: `Unsupported event type: ${eventType}`,
        });
      }
    }
  }

  return errors;
}

export function validateWebhookDispatchRequest(body) {
  if (body === undefined || body === null) {
    return [];
  }

  const errors = [];
  validateRequiredField(errors, isObject(body), 'body', 'Request body must be a JSON object.');
  if (errors.length) {
    return errors;
  }

  if (
    body.limit !== undefined &&
    (!Number.isInteger(body.limit) || body.limit <= 0)
  ) {
    errors.push({
      field: 'limit',
      message: 'limit must be a positive integer when provided.',
    });
  }

  if (body.subscription_id !== undefined && !hasText(body.subscription_id)) {
    errors.push({
      field: 'subscription_id',
      message: 'subscription_id must be a non-empty string when provided.',
    });
  }

  return errors;
}

export function isPlainObject(value) {
  return isObject(value);
}
