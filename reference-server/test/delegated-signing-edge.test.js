import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApp } from '../src/app.js';

// Regression tests for the delegated-signing bugs found by the review.

function delegatedPayload(e2e, extra = {}) {
  return {
    payment_identification: { end_to_end_identification: e2e },
    charge_bearer: 'DEBT',
    debtor: { name: 'Acme Trading GmbH', lei: '529900T8BM49AURSDO55' },
    creditor: { name: 'Bravo Supplies B.V.', lei: '724500QHKL6MVSQQ1Z17' },
    interbank_settlement_amount: { amount: '250000.00', currency: 'USD' },
    blockchain_instruction: {
      token: { token_symbol: 'USDC', token_dti: 'T9B3X8H2K' },
      chain_dli: 'X9J9XDMTD',
      custody_model: 'DELEGATED_SIGNING',
    },
    ...extra,
  };
}

test('a cancelled held DELEGATED_SIGNING instruction cannot be revived by signing', async () => {
  const app = await buildApp();

  const create = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: delegatedPayload('INV-CANCEL-SIGN'),
  });
  assert.equal(create.statusCode, 201);
  const id = create.json().instruction_id;

  const cancel = await app.inject({ method: 'DELETE', url: `/instruction/${id}` });
  assert.equal(cancel.json().status, 'CANCELLED');

  // The signed transaction must be rejected — a cancelled payment cannot settle.
  const sign = await app.inject({
    method: 'POST',
    url: `/instruction/${id}/signed-transaction`,
    payload: { signed_transaction_data: '0xsigned' },
  });
  assert.equal(sign.statusCode, 409);

  const get = await app.inject({ method: 'GET', url: `/instruction/${id}` });
  assert.equal(get.json().status, 'CANCELLED');

  await app.close();
});

test('concurrent signed-transaction submissions execute exactly once (no lost update)', async () => {
  const app = await buildApp();
  const store = app.store;

  const created = await store.createInstructionAsync(delegatedPayload('INV-CONCURRENT-SIGN'));
  assert.equal(created.awaiting_signed_transaction, true);
  const id = created.instruction_id;

  const [a, b] = await Promise.all([
    store.submitSignedTransactionAsync(id, { signed_transaction_data: '0xfirst' }),
    store.submitSignedTransactionAsync(id, { signed_transaction_data: '0xsecond' }),
  ]);

  // Serialized: both callers share one execution, so the second cannot
  // double-progress the record or overwrite the first writer's signed data.
  assert.equal(a, b);
  assert.equal(a.record.signed_transaction.signed_transaction_data, '0xfirst');

  await app.close();
});

test('a held DELEGATED_SIGNING instruction expires when its signing window lapses', async () => {
  const app = await buildApp();

  const shortExpiry = new Date(Date.now() + 250).toISOString();
  const create = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: delegatedPayload('INV-HOLD-EXPIRE', { expiry_date_time: shortExpiry }),
  });
  assert.equal(create.statusCode, 201);
  assert.equal(create.json().awaiting_signed_transaction, true, 'created while still held');
  const id = create.json().instruction_id;

  await new Promise((resolve) => setTimeout(resolve, 400));

  const get = await app.inject({ method: 'GET', url: `/instruction/${id}` });
  assert.equal(get.json().status, 'EXPIRED');
  assert.equal(get.json().awaiting_signed_transaction, false);

  // An expired hold can no longer be signed.
  const sign = await app.inject({
    method: 'POST',
    url: `/instruction/${id}/signed-transaction`,
    payload: { signed_transaction_data: '0xtoolate' },
  });
  assert.equal(sign.statusCode, 409);

  await app.close();
});

test('signed-transaction submission rejects an invalid transaction_format', async () => {
  const app = await buildApp();

  const create = await app.inject({
    method: 'POST',
    url: '/instruction',
    payload: delegatedPayload('INV-BAD-FORMAT'),
  });
  const id = create.json().instruction_id;

  const sign = await app.inject({
    method: 'POST',
    url: `/instruction/${id}/signed-transaction`,
    payload: { transaction_format: 'BOGUS', signed_transaction_data: '0xabc' },
  });
  assert.equal(sign.statusCode, 400);
  assert.ok(sign.json().details.some((d) => d.field === 'transaction_format'));

  await app.close();
});
