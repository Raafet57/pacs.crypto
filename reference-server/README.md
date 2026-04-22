# pacs.crypto Reference Server

First executable slice of the `pacs.crypto` reference stack.

Current scope:

- `GET /health`
- `POST /travel-rule`
- `GET /travel-rule/:recordId`
- `PUT /travel-rule/:recordId`
- `POST /travel-rule/:recordId/callback`
- `GET /travel-rule/search`
- `GET /travel-rule/stats`
- `POST /instruction/quote`
- `POST /instruction`
- `GET /instruction/:instructionId`
- `DELETE /instruction/:instructionId`
- `GET /instruction/search`
- `GET /execution-status/:instructionId`
- `GET /execution-status/uetr/:uetr`
- `GET /finality-receipt/:instructionId`
- `GET /finality-receipt/uetr/:uetr`
- `GET /event-outbox`
- `GET /event-outbox/:eventId`
- `POST /webhook-endpoints`
- `GET /webhook-endpoints`
- `GET /webhook-endpoints/:subscriptionId`
- `GET /webhook-endpoints/:subscriptionId/deliveries`
- `GET /webhook-deliveries`
- `GET /webhook-deliveries/:deliveryId`
- `POST /webhook-deliveries/dispatch`
- `GET /reporting/notifications`
- `GET /reporting/notifications/:notificationId`
- `GET /reporting/intraday`
- `GET /reporting/statements`
- `GET /reporting/statements/:statementId`

## Run

```bash
npm install
npm start
```

Server defaults:

- host: `127.0.0.1`
- port: `5050`
- database: `reference-server/data/reference-stack.sqlite`

Environment overrides:

- `REF_SERVER_HOST`
- `REF_SERVER_PORT`
- `REF_SERVER_DB_PATH`

## Notes

- Persistence uses Node's built-in `node:sqlite` module.
- Instruction status progression is deterministic and mocked for now:
  `PENDING -> BROADCAST -> CONFIRMING -> FINAL`
- `execution-status` is the pacs.002-like read surface for lifecycle state and history.
- `finality-receipt` is the camt.025-like read surface for transaction hash, confirmations, and finality proof.
- `event-outbox` is the webhook-style delivery mirror. Event payloads are the same objects returned by `execution-status` and `finality-receipt`, so push and poll stay aligned.
- Webhook deliveries are HMAC-signed with `x-pacscrypto-signature` over `<timestamp>.<raw-body>`, plus delivery and event ids in headers.
- Delivery retries are persisted with `PENDING`, `RETRYING`, `DELIVERED`, and `FAILED` states. Dispatch is manual for now via `POST /webhook-deliveries/dispatch`.
- `reporting/notifications` is the first reporting-family surface: a `camt.054` analogue for booked debtor debit and creditor credit notifications keyed to the instruction lifecycle.
- `reporting/intraday` is the next reporting-family surface: a narrow `camt.052` analogue summarizing booked intraday movements and account views from those notifications.
- `reporting/statements` starts the statement layer: a `camt.053` analogue that persists per-instruction account statements derived from the existing reporting notifications and instruction context.
- Reporting notifications are also emitted as `reporting_notification.created` events through the same outbox and webhook delivery pipeline.
- Delegated signing is intentionally not implemented in this first slice.
- The root HTML simulators support both `Demo` mode and `Live API` mode against this server.
