import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { buildApp } from '../src/app.js';

test('travel rule submit -> callback -> retrieve', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/travel-rule',
    payload: {
      travel_rule_data: {
        payment_identification: {
          end_to_end_identification: 'E2E-TR-001',
        },
        debtor: { name: 'Acme Trading GmbH' },
        debtor_account: {
          proxy: { identification: '0xabc' },
        },
        creditor: { name: 'Bravo Supplies B.V.' },
        creditor_account: {
          proxy: { identification: '0xdef' },
        },
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const createdRecord = createResponse.json();
  assert.equal(createdRecord.status, 'SUBMITTED');
  assert.equal(createdRecord.submission_timing, 'PRE_TX');

  const callbackResponse = await app.inject({
    method: 'POST',
    url: `/travel-rule/${createdRecord.record_id}/callback`,
    payload: {
      callback_status: 'ACCEPTED',
      description: 'Data quality sufficient.',
    },
  });

  assert.equal(callbackResponse.statusCode, 200);
  assert.equal(callbackResponse.json().status, 'ACCEPTED');

  const getResponse = await app.inject({
    method: 'GET',
    url: `/travel-rule/${createdRecord.record_id}`,
  });

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.json().callbacks.length, 1);

  await app.close();
});

test('quote -> instruction -> get status', async () => {
  const app = await buildApp();

  const quoteResponse = await app.inject({
    method: 'POST',
    url: '/instruction/quote',
    payload: {
      token: { token_symbol: 'USDC', token_dti: '4H95J0R2X' },
      chain_dli: 'X9J9XDMTD',
      amount: '250000.00',
      currency: 'USD',
      custody_model: 'FULL_CUSTODY',
    },
  });

  assert.equal(quoteResponse.statusCode, 200);
  const quote = quoteResponse.json();
  assert.ok(quote.quote_id);

  const instructionResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-042',
        quote_id: quote.quote_id,
      },
      interbank_settlement_amount: {
        amount: '250000.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(instructionResponse.statusCode, 201);
  const instruction = instructionResponse.json();
  assert.equal(instruction.status, 'PENDING');
  assert.equal(instruction.debit_timing, 'ON_BROADCAST');
  assert.ok(instruction.fee_estimate);

  const getResponse = await app.inject({
    method: 'GET',
    url: `/instruction/${instruction.instruction_id}`,
  });

  assert.equal(getResponse.statusCode, 200);
  assert.ok(getResponse.json().instruction_id);
  assert.ok(['PENDING', 'BROADCAST', 'CONFIRMING', 'FINAL'].includes(getResponse.json().status));

  const searchResponse = await app.inject({
    method: 'GET',
    url: '/instruction/search?status=PENDING&page_size=10',
  });

  assert.equal(searchResponse.statusCode, 200);
  assert.ok(Array.isArray(searchResponse.json().instructions));
  assert.equal(searchResponse.json().total_matched, 1);
  assert.equal(searchResponse.json().instructions[0].debtor_name, null);

  await app.close();
});

test('quote request validates required fields', async () => {
  const app = await buildApp();

  const response = await app.inject({
    method: 'POST',
    url: '/instruction/quote',
    payload: {
      chain_dli: 'X9J9XDMTD',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.ok(Array.isArray(response.json().details));

  await app.close();
});

test('duplicate end_to_end_identification returns 409 with original instruction id', async () => {
  const app = await buildApp();

  const payload = {
    payment_identification: {
      end_to_end_identification: 'INV-042',
    },
    interbank_settlement_amount: {
      amount: '250000.00',
      currency: 'USD',
    },
    blockchain_instruction: {
      token: {
        token_symbol: 'USDC',
        token_dti: '4H95J0R2X',
      },
      chain_dli: 'X9J9XDMTD',
      custody_model: 'FULL_CUSTODY',
    },
  };

  const firstResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload,
  });

  const duplicateResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload,
  });

  assert.equal(firstResponse.statusCode, 201);
  assert.equal(duplicateResponse.statusCode, 409);
  assert.equal(
    duplicateResponse.json().instruction_id,
    firstResponse.json().instruction_id,
  );

  await app.close();
});

test('pending instruction can be cancelled before broadcast', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-043',
      },
      interbank_settlement_amount: {
        amount: '1000.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  const cancelResponse = await app.inject({
    method: 'DELETE',
    url: `/instruction/${createResponse.json().instruction_id}`,
  });

  assert.equal(cancelResponse.statusCode, 200);
  assert.equal(cancelResponse.json().status, 'CANCELLED');

  await app.close();
});

test('travel rule search and stats return spec-like envelope', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/travel-rule',
    payload: {
      submission_timing: 'POST_TX',
      travel_rule_data: {
        payment_identification: {
          end_to_end_identification: 'E2E-001',
        },
        interbank_settlement_amount: {
          amount: '50000.00',
          currency: 'EUR',
        },
        debtor: { name: 'Acme Trading GmbH' },
        debtor_agent: { lei: '7245007VX57GR4IUVZ79' },
        debtor_account: {
          proxy: { identification: '0xabc' },
        },
        creditor: { name: 'Bravo Supplies B.V.' },
        creditor_agent: { lei: '5299000DUFB71VFOHVB49' },
        creditor_account: {
          proxy: { identification: '0xdef' },
        },
        blockchain_settlement: {
          primary_chain_id: 'DLID/X9J9XDMTD',
          legs: [{ leg_type: 'ORIGINATION' }],
        },
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);

  const searchResponse = await app.inject({
    method: 'GET',
    url: '/travel-rule/search?status=SUBMITTED&submitted_from=2025-01-01T00:00:00Z&submitted_to=2030-01-01T00:00:00Z&page_size=1',
  });

  assert.equal(searchResponse.statusCode, 200);
  assert.equal(searchResponse.json().total_matched, 1);
  assert.equal(searchResponse.json().page_size, 1);
  assert.equal(searchResponse.json().records[0].latest_callback_status, 'PENDING');
  assert.equal(searchResponse.json().records[0].primary_chain_id, 'DLID/X9J9XDMTD');

  const statsResponse = await app.inject({
    method: 'GET',
    url: '/travel-rule/stats?submitted_from=2025-01-01T00:00:00Z&submitted_to=2030-01-01T00:00:00Z&group_by=status',
  });

  assert.equal(statsResponse.statusCode, 200);
  assert.equal(statsResponse.json().totals.record_count, 1);
  assert.equal(statsResponse.json().totals.volumes[0].currency, 'EUR');
  assert.equal(statsResponse.json().direction, 'BOTH');
  assert.equal(statsResponse.json().breakdown[0].dimension_value, 'SUBMITTED');

  await app.close();
});

test('accepted travel rule record rejects superseding callback', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/travel-rule',
    payload: {
      travel_rule_data: {
        payment_identification: {
          end_to_end_identification: 'E2E-ACCEPTED-001',
        },
        debtor: { name: 'Acme Trading GmbH' },
        debtor_account: {
          proxy: { identification: '0xabc' },
        },
        creditor: { name: 'Bravo Supplies B.V.' },
        creditor_account: {
          proxy: { identification: '0xdef' },
        },
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);

  const acceptedResponse = await app.inject({
    method: 'POST',
    url: `/travel-rule/${createResponse.json().record_id}/callback`,
    payload: {
      callback_status: 'ACCEPTED',
    },
  });

  assert.equal(acceptedResponse.statusCode, 200);

  const rejectedResponse = await app.inject({
    method: 'POST',
    url: `/travel-rule/${createResponse.json().record_id}/callback`,
    payload: {
      callback_status: 'REJECTED',
      rejection_reasons: [{ field: 'debtor.name', code: 'INVALID' }],
    },
  });

  assert.equal(rejectedResponse.statusCode, 409);

  await app.close();
});

test('execution status can be retrieved by instruction id and uetr', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-044',
      },
      interbank_settlement_amount: {
        amount: '2750.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();

  const byInstructionIdResponse = await app.inject({
    method: 'GET',
    url: `/execution-status/${instruction.instruction_id}`,
  });

  assert.equal(byInstructionIdResponse.statusCode, 200);
  assert.equal(byInstructionIdResponse.json().status, 'PENDING');
  assert.equal(byInstructionIdResponse.json().status_group, 'PRE_EXECUTION');
  assert.equal(byInstructionIdResponse.json().transaction_hash, null);
  assert.equal(byInstructionIdResponse.json().status_history.length, 1);
  assert.equal(byInstructionIdResponse.json().status_history[0].status, 'PENDING');

  const byUetrResponse = await app.inject({
    method: 'GET',
    url: `/execution-status/uetr/${instruction.uetr}`,
  });

  assert.equal(byUetrResponse.statusCode, 200);
  assert.equal(
    byUetrResponse.json().instruction_id,
    instruction.instruction_id,
  );

  await app.close();
});

test('finality receipt reflects settled on-chain state and supports uetr lookup', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-045',
      },
      interbank_settlement_amount: {
        amount: '5000.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();
  const currentRecord = app.store.getInstruction(instruction.instruction_id);
  const agedTimestamp = new Date(Date.now() - 7000).toISOString();
  app.store.saveInstruction({
    ...currentRecord,
    created_at: agedTimestamp,
    updated_at: agedTimestamp,
  });

  const byInstructionIdResponse = await app.inject({
    method: 'GET',
    url: `/finality-receipt/${instruction.instruction_id}`,
  });

  assert.equal(byInstructionIdResponse.statusCode, 200);
  assert.equal(byInstructionIdResponse.json().instruction_status, 'FINAL');
  assert.equal(byInstructionIdResponse.json().finality_status, 'FINAL');
  assert.equal(byInstructionIdResponse.json().confirmation_depth, 12);
  assert.ok(byInstructionIdResponse.json().transaction_hash);
  assert.ok(byInstructionIdResponse.json().final_at);

  const byUetrResponse = await app.inject({
    method: 'GET',
    url: `/finality-receipt/uetr/${instruction.uetr}`,
  });

  assert.equal(byUetrResponse.statusCode, 200);
  assert.equal(byUetrResponse.json().instruction_id, instruction.instruction_id);

  await app.close();
});

test('execution status history captures cancellation as a terminal event', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-046',
      },
      interbank_settlement_amount: {
        amount: '310.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);

  const cancelResponse = await app.inject({
    method: 'DELETE',
    url: `/instruction/${createResponse.json().instruction_id}`,
  });

  assert.equal(cancelResponse.statusCode, 200);

  const statusResponse = await app.inject({
    method: 'GET',
    url: `/execution-status/${createResponse.json().instruction_id}`,
  });

  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().status, 'CANCELLED');
  assert.equal(statusResponse.json().status_group, 'CANCELLED');
  assert.equal(statusResponse.json().status_history.length, 2);
  assert.equal(
    statusResponse.json().status_history.at(-1).reason_code,
    'CANCELLED_BY_INSTRUCTING_PARTY',
  );

  await app.close();
});

test('event outbox mirrors initial execution status and finality payloads', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-047',
      },
      interbank_settlement_amount: {
        amount: '725.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();

  const outboxResponse = await app.inject({
    method: 'GET',
    url: `/event-outbox?instruction_id=${instruction.instruction_id}`,
  });

  assert.equal(outboxResponse.statusCode, 200);
  assert.equal(outboxResponse.json().total_matched, 2);
  assert.equal(
    outboxResponse.json().events.some((event) => event.event_type === 'execution_status.updated'),
    true,
  );
  assert.equal(
    outboxResponse.json().events.some((event) => event.event_type === 'finality_receipt.updated'),
    true,
  );

  const executionStatusEvent = outboxResponse.json().events.find(
    (event) => event.event_type === 'execution_status.updated',
  );
  const finalityEvent = outboxResponse.json().events.find(
    (event) => event.event_type === 'finality_receipt.updated',
  );

  assert.equal(executionStatusEvent.payload.status, 'PENDING');
  assert.equal(finalityEvent.payload.instruction_status, 'PENDING');

  const eventLookupResponse = await app.inject({
    method: 'GET',
    url: `/event-outbox/${executionStatusEvent.event_id}`,
  });

  assert.equal(eventLookupResponse.statusCode, 200);
  assert.equal(eventLookupResponse.json().event_id, executionStatusEvent.event_id);

  await app.close();
});

test('event outbox records final lifecycle transitions with mirrored payloads', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-048',
      },
      interbank_settlement_amount: {
        amount: '9825.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();
  const currentRecord = app.store.getInstruction(instruction.instruction_id);
  const agedTimestamp = new Date(Date.now() - 7000).toISOString();
  app.store.saveInstruction({
    ...currentRecord,
    created_at: agedTimestamp,
    updated_at: agedTimestamp,
  });

  const statusResponse = await app.inject({
    method: 'GET',
    url: `/execution-status/${instruction.instruction_id}`,
  });

  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().status, 'FINAL');

  const outboxResponse = await app.inject({
    method: 'GET',
    url: `/event-outbox?instruction_id=${instruction.instruction_id}&event_type=execution_status.updated,finality_receipt.updated`,
  });

  assert.equal(outboxResponse.statusCode, 200);
  assert.equal(outboxResponse.json().total_matched, 4);

  const finalStatusEvent = outboxResponse.json().events.find(
    (event) =>
      event.event_type === 'execution_status.updated' &&
      event.payload.status === 'FINAL',
  );
  const finalityEvent = outboxResponse.json().events.find(
    (event) =>
      event.event_type === 'finality_receipt.updated' &&
      event.payload.finality_status === 'FINAL',
  );

  assert.ok(finalStatusEvent);
  assert.ok(finalityEvent);
  assert.equal(finalStatusEvent.payload.instruction_id, instruction.instruction_id);
  assert.equal(finalityEvent.payload.instruction_id, instruction.instruction_id);

  await app.close();
});

test('webhook subscriptions receive signed deliveries for outbox events', async () => {
  const signingSecret = 'whsec_test_123456';
  const deliveriesReceived = [];
  const app = await buildApp({
    webhookSender: async ({ url, headers, body }) => {
      deliveriesReceived.push({ url, headers, body });
      return {
        status: 202,
        bodyText: 'accepted',
      };
    },
  });

  const subscriptionResponse = await app.inject({
    method: 'POST',
    url: '/webhook-endpoints',
    payload: {
      url: 'https://receiver.example/pacs',
      signing_secret: signingSecret,
      subscribed_event_types: [
        'execution_status.updated',
        'finality_receipt.updated',
      ],
      description: 'Treasury lifecycle receiver',
    },
  });

  assert.equal(subscriptionResponse.statusCode, 201);
  const subscription = subscriptionResponse.json();
  assert.equal(subscription.signing_secret, signingSecret);

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-049',
      },
      interbank_settlement_amount: {
        amount: '1800.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();

  const pendingDeliveriesResponse = await app.inject({
    method: 'GET',
    url: `/webhook-endpoints/${subscription.subscription_id}/deliveries`,
  });

  assert.equal(pendingDeliveriesResponse.statusCode, 200);
  assert.equal(pendingDeliveriesResponse.json().total_matched, 2);

  const dispatchResponse = await app.inject({
    method: 'POST',
    url: '/webhook-deliveries/dispatch',
    payload: {
      subscription_id: subscription.subscription_id,
      limit: 10,
    },
  });

  assert.equal(dispatchResponse.statusCode, 200);
  assert.equal(dispatchResponse.json().dispatched_count, 2);
  assert.equal(deliveriesReceived.length, 2);

  const firstDelivery = deliveriesReceived[0];
  const timestamp = firstDelivery.headers['x-pacscrypto-signature-timestamp'];
  const expectedDigest = createHmac('sha256', signingSecret)
    .update(`${timestamp}.${firstDelivery.body}`)
    .digest('hex');
  assert.equal(
    firstDelivery.headers['x-pacscrypto-signature'],
    `t=${timestamp},v1=${expectedDigest}`,
  );

  const parsedEnvelope = JSON.parse(firstDelivery.body);
  assert.equal(parsedEnvelope.instruction_id, instruction.instruction_id);
  assert.ok(
    ['execution_status.updated', 'finality_receipt.updated'].includes(
      parsedEnvelope.event_type,
    ),
  );

  const deliveredResponse = await app.inject({
    method: 'GET',
    url: `/webhook-endpoints/${subscription.subscription_id}/deliveries?delivery_state=DELIVERED`,
  });

  assert.equal(deliveredResponse.statusCode, 200);
  assert.equal(deliveredResponse.json().total_matched, 2);
  assert.equal(
    deliveredResponse.json().deliveries.every(
      (delivery) => delivery.response_status === 202,
    ),
    true,
  );

  const subscriptionLookupResponse = await app.inject({
    method: 'GET',
    url: `/webhook-endpoints/${subscription.subscription_id}`,
  });

  assert.equal(subscriptionLookupResponse.statusCode, 200);
  assert.ok(subscriptionLookupResponse.json().last_delivery_at);

  await app.close();
});

test('webhook deliveries retry on non-2xx endpoint responses', async () => {
  const app = await buildApp({
    webhookSender: async () => ({
      status: 500,
      bodyText: 'upstream unavailable',
    }),
  });

  const subscriptionResponse = await app.inject({
    method: 'POST',
    url: '/webhook-endpoints',
    payload: {
      url: 'https://receiver.example/retry',
      signing_secret: 'whsec_retry_123456',
      subscribed_event_types: ['execution_status.updated'],
    },
  });

  assert.equal(subscriptionResponse.statusCode, 201);
  const subscription = subscriptionResponse.json();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-050',
      },
      interbank_settlement_amount: {
        amount: '900.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);

  const dispatchResponse = await app.inject({
    method: 'POST',
    url: '/webhook-deliveries/dispatch',
    payload: {
      subscription_id: subscription.subscription_id,
    },
  });

  assert.equal(dispatchResponse.statusCode, 200);
  assert.equal(dispatchResponse.json().dispatched_count, 1);
  assert.equal(dispatchResponse.json().deliveries[0].delivery_state, 'RETRYING');

  const retryingDeliveriesResponse = await app.inject({
    method: 'GET',
    url: `/webhook-endpoints/${subscription.subscription_id}/deliveries?delivery_state=RETRYING`,
  });

  assert.equal(retryingDeliveriesResponse.statusCode, 200);
  assert.equal(retryingDeliveriesResponse.json().total_matched, 1);
  assert.equal(retryingDeliveriesResponse.json().deliveries[0].attempt_count, 1);
  assert.equal(retryingDeliveriesResponse.json().deliveries[0].response_status, 500);
  assert.match(
    retryingDeliveriesResponse.json().deliveries[0].last_error,
    /HTTP 500/,
  );
  assert.ok(
    Date.parse(retryingDeliveriesResponse.json().deliveries[0].next_attempt_at) >
      Date.parse(retryingDeliveriesResponse.json().deliveries[0].last_attempt_at),
  );

  await app.close();
});

test('reporting notifications are created when an instruction reaches settlement milestones', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-051',
      },
      debtor: {
        name: 'Acme Trading GmbH',
        lei: '529900T8BM49AURSDO55',
      },
      debtor_account: {
        proxy: { identification: '0xdebtoracct' },
      },
      debtor_agent: {
        name: 'Bitvavo B.V.',
        lei: '7245007VX57GR4IUVZ79',
      },
      creditor: {
        name: 'Bravo Supplies B.V.',
        lei: '724500QHKL6MVSQQ1Z17',
      },
      creditor_account: {
        proxy: { identification: '0xcreditoracct' },
      },
      creditor_agent: {
        name: 'Kraken Belgium BVBA',
        lei: '5299000DUFB71VFOHVB49',
      },
      interbank_settlement_amount: {
        amount: '4250.00',
        currency: 'USD',
      },
      remittance_information: {
        unstructured: 'INV-2025-777 / Supplier payment',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();

  const initialNotificationsResponse = await app.inject({
    method: 'GET',
    url: `/reporting/notifications?instruction_id=${instruction.instruction_id}`,
  });

  assert.equal(initialNotificationsResponse.statusCode, 200);
  assert.equal(initialNotificationsResponse.json().total_matched, 0);

  const currentRecord = app.store.getInstruction(instruction.instruction_id);
  const agedTimestamp = new Date(Date.now() - 7000).toISOString();
  app.store.saveInstruction({
    ...currentRecord,
    created_at: agedTimestamp,
    updated_at: agedTimestamp,
  });

  const statusResponse = await app.inject({
    method: 'GET',
    url: `/instruction/${instruction.instruction_id}`,
  });

  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().status, 'FINAL');

  const notificationsResponse = await app.inject({
    method: 'GET',
    url: `/reporting/notifications?instruction_id=${instruction.instruction_id}`,
  });

  assert.equal(notificationsResponse.statusCode, 200);
  assert.equal(notificationsResponse.json().total_matched, 2);
  assert.equal(
    notificationsResponse.json().notifications.some(
      (notification) =>
        notification.entry_type === 'DEBIT' &&
        notification.account_role === 'DEBTOR',
    ),
    true,
  );
  assert.equal(
    notificationsResponse.json().notifications.some(
      (notification) =>
        notification.entry_type === 'CREDIT' &&
        notification.account_role === 'CREDITOR',
    ),
    true,
  );

  const debitNotification = notificationsResponse.json().notifications.find(
    (notification) => notification.entry_type === 'DEBIT',
  );

  const debitNotificationDetailResponse = await app.inject({
    method: 'GET',
    url: `/reporting/notifications/${debitNotification.notification_id}`,
  });

  assert.equal(debitNotificationDetailResponse.statusCode, 200);
  assert.equal(debitNotificationDetailResponse.json().party.wallet_address, '0xdebtoracct');
  assert.equal(
    debitNotificationDetailResponse.json().counterparty.wallet_address,
    '0xcreditoracct',
  );
  assert.equal(
    debitNotificationDetailResponse.json().status_reference.trigger_status,
    'BROADCAST',
  );
  assert.equal(
    debitNotificationDetailResponse.json().remittance_information.unstructured,
    'INV-2025-777 / Supplier payment',
  );

  const filteredNotificationsResponse = await app.inject({
    method: 'GET',
    url: `/reporting/notifications?instruction_id=${instruction.instruction_id}&entry_type=DEBIT`,
  });

  assert.equal(filteredNotificationsResponse.statusCode, 200);
  assert.equal(filteredNotificationsResponse.json().total_matched, 1);

  await app.close();
});

test('reporting notifications are emitted through outbox and webhook delivery', async () => {
  const deliveriesReceived = [];
  const app = await buildApp({
    webhookSender: async ({ headers, body }) => {
      deliveriesReceived.push({ headers, body });
      return {
        status: 200,
        bodyText: 'ok',
      };
    },
  });

  const subscriptionResponse = await app.inject({
    method: 'POST',
    url: '/webhook-endpoints',
    payload: {
      url: 'https://receiver.example/reporting',
      signing_secret: 'whsec_reporting_123456',
      subscribed_event_types: ['reporting_notification.created'],
    },
  });

  assert.equal(subscriptionResponse.statusCode, 201);
  const subscription = subscriptionResponse.json();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-052',
      },
      debtor: { name: 'Acme Trading GmbH' },
      debtor_account: {
        proxy: { identification: '0xreportdebit' },
      },
      creditor: { name: 'Bravo Supplies B.V.' },
      creditor_account: {
        proxy: { identification: '0xreportcredit' },
      },
      interbank_settlement_amount: {
        amount: '6400.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();

  const currentRecord = app.store.getInstruction(instruction.instruction_id);
  const agedTimestamp = new Date(Date.now() - 7000).toISOString();
  app.store.saveInstruction({
    ...currentRecord,
    created_at: agedTimestamp,
    updated_at: agedTimestamp,
  });

  const statusResponse = await app.inject({
    method: 'GET',
    url: `/instruction/${instruction.instruction_id}`,
  });

  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().status, 'FINAL');

  const outboxResponse = await app.inject({
    method: 'GET',
    url: `/event-outbox?instruction_id=${instruction.instruction_id}&event_type=reporting_notification.created`,
  });

  assert.equal(outboxResponse.statusCode, 200);
  assert.equal(outboxResponse.json().total_matched, 2);

  const dispatchResponse = await app.inject({
    method: 'POST',
    url: '/webhook-deliveries/dispatch',
    payload: {
      subscription_id: subscription.subscription_id,
    },
  });

  assert.equal(dispatchResponse.statusCode, 200);
  assert.equal(dispatchResponse.json().dispatched_count, 2);
  assert.equal(deliveriesReceived.length, 2);

  const envelope = JSON.parse(deliveriesReceived[0].body);
  assert.equal(envelope.event_type, 'reporting_notification.created');
  assert.ok(envelope.payload.notification_id);

  const deliveredResponse = await app.inject({
    method: 'GET',
    url: `/webhook-endpoints/${subscription.subscription_id}/deliveries?delivery_state=DELIVERED`,
  });

  assert.equal(deliveredResponse.statusCode, 200);
  assert.equal(deliveredResponse.json().total_matched, 2);

  await app.close();
});

test('intraday reporting view summarizes booked movements and supports account filters', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-053',
      },
      debtor: {
        name: 'Acme Trading GmbH',
        lei: '529900T8BM49AURSDO55',
      },
      debtor_account: {
        proxy: { identification: '0xintradaydebit' },
      },
      creditor: {
        name: 'Bravo Supplies B.V.',
        lei: '724500QHKL6MVSQQ1Z17',
      },
      creditor_account: {
        proxy: { identification: '0xintradaycredit' },
      },
      interbank_settlement_amount: {
        amount: '5100.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();
  const currentRecord = app.store.getInstruction(instruction.instruction_id);
  const agedTimestamp = new Date(Date.now() - 7000).toISOString();
  app.store.saveInstruction({
    ...currentRecord,
    created_at: agedTimestamp,
    updated_at: agedTimestamp,
  });

  const statusResponse = await app.inject({
    method: 'GET',
    url: `/instruction/${instruction.instruction_id}`,
  });

  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().status, 'FINAL');

  const intradayResponse = await app.inject({
    method: 'GET',
    url: `/reporting/intraday?instruction_id=${instruction.instruction_id}`,
  });

  assert.equal(intradayResponse.statusCode, 200);
  assert.equal(intradayResponse.json().movement_summary.notification_count, 2);
  assert.equal(intradayResponse.json().movement_summary.debit_count, 1);
  assert.equal(intradayResponse.json().movement_summary.credit_count, 1);
  assert.equal(intradayResponse.json().account_views.length, 2);
  assert.equal(intradayResponse.json().movement_summary.totals[0].currency, 'USD');

  const debtorOnlyResponse = await app.inject({
    method: 'GET',
    url: `/reporting/intraday?instruction_id=${instruction.instruction_id}&account_role=DEBTOR`,
  });

  assert.equal(debtorOnlyResponse.statusCode, 200);
  assert.equal(debtorOnlyResponse.json().movement_summary.notification_count, 1);
  assert.equal(debtorOnlyResponse.json().account_views.length, 1);
  assert.equal(
    debtorOnlyResponse.json().account_views[0].wallet_address,
    '0xintradaydebit',
  );
  assert.equal(
    debtorOnlyResponse.json().movement_summary.totals[0].net_total,
    '-5100',
  );

  await app.close();
});

test('statement reporting derives persisted account statements from reporting notifications', async () => {
  const app = await buildApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: {
      payment_identification: {
        end_to_end_identification: 'INV-054',
      },
      debtor: {
        name: 'Acme Trading GmbH',
        lei: '529900T8BM49AURSDO55',
      },
      debtor_account: {
        proxy: { identification: '0xstatementdebit' },
      },
      creditor: {
        name: 'Bravo Supplies B.V.',
        lei: '724500QHKL6MVSQQ1Z17',
      },
      creditor_account: {
        proxy: { identification: '0xstatementcredit' },
      },
      interbank_settlement_amount: {
        amount: '5100.00',
        currency: 'USD',
      },
      blockchain_instruction: {
        token: {
          token_symbol: 'USDC',
          token_dti: '4H95J0R2X',
        },
        chain_dli: 'X9J9XDMTD',
        custody_model: 'FULL_CUSTODY',
      },
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const instruction = createResponse.json();
  const currentRecord = app.store.getInstruction(instruction.instruction_id);
  const agedTimestamp = new Date(Date.now() - 7000).toISOString();
  app.store.saveInstruction({
    ...currentRecord,
    created_at: agedTimestamp,
    updated_at: agedTimestamp,
  });

  const statusResponse = await app.inject({
    method: 'GET',
    url: `/instruction/${instruction.instruction_id}`,
  });

  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().status, 'FINAL');

  const statementsResponse = await app.inject({
    method: 'GET',
    url: `/reporting/statements?instruction_id=${instruction.instruction_id}`,
  });

  assert.equal(statementsResponse.statusCode, 200);
  assert.equal(statementsResponse.json().total_matched, 2);
  assert.equal(statementsResponse.json().statements.length, 2);

  const debtorStatement = statementsResponse.json().statements.find(
    (statement) => statement.account_role === 'DEBTOR',
  );

  assert.ok(debtorStatement);
  assert.equal(debtorStatement.balance_summary.closing_balance.amount, '-5100');
  assert.equal(debtorStatement.movement_summary.entry_count, 1);
  assert.equal(debtorStatement.instruction_context.finality_status, 'FINAL');

  const debtorStatementDetailResponse = await app.inject({
    method: 'GET',
    url: `/reporting/statements/${debtorStatement.statement_id}`,
  });

  assert.equal(debtorStatementDetailResponse.statusCode, 200);
  assert.equal(debtorStatementDetailResponse.json().entries.length, 1);
  assert.equal(debtorStatementDetailResponse.json().entries[0].entry_type, 'DEBIT');

  const filteredStatementsResponse = await app.inject({
    method: 'GET',
    url: `/reporting/statements?instruction_id=${instruction.instruction_id}&account_role=DEBTOR&wallet_address=0xstatementdebit`,
  });

  assert.equal(filteredStatementsResponse.statusCode, 200);
  assert.equal(filteredStatementsResponse.json().total_matched, 1);
  assert.equal(filteredStatementsResponse.json().statements[0].statement_id, debtorStatement.statement_id);

  await app.close();
});
