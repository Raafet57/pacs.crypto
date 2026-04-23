# Exception-Family Design

This document makes the exception-family boundary decision-ready for the current
`pacs.crypto` wedge.

It does not implement the family. It defines what the first implementation
should be and, equally importantly, what it must not pretend to do.

## Purpose

The current stack already has terminal and exceptional statuses:

- `CANCELLED`
- `EXPIRED`
- `FAILED`
- `SLIPPAGE_EXCEEDED`
- `RAMP_FAILED`

Those are necessary, but they are not a full exception-family.

The missing design question is:

- when does an operational exception remain part of the existing instruction
  lifecycle
- and when does it become a new cross-party exception or remediation object

## Core Rule

Blockchain irreversibility must remain explicit.

That means:

- pre-broadcast cancellation is a workflow control decision
- post-settlement remediation is a new economic action, not a hidden reversal of
  the original transfer
- investigations are case-management objects, not overloaded status fields

## Decision Summary

### Stays in current APIs

These behaviors stay where they are:

- `DELETE /instruction/{instructionId}` for pre-broadcast cancellation only
- terminal execution outcomes on `execution-status`
- finality proof on `finality-receipt`
- Travel Rule correction on the existing Travel Rule record

These do **not** require a new family for the current wedge.

### Becomes a new family later

These behaviors should become explicit exception-family objects:

- post-settlement return or compensating transfer
- cross-party cancellation negotiation once there is real bilateral workflow
- investigation and case handling across instruction, finality, reporting, and
  Travel Rule references

## Exception Taxonomy

### 1. Pre-broadcast cancellation

Definition:

- the instructing party withdraws the payment before on-chain broadcast

Current system behavior:

- remains in the current instruction API
- terminal status is `CANCELLED`
- no exception-family object is required for the current wedge

Reason:

- this is still command-surface behavior, not post-fact remediation

### 2. Pre-execution expiry or bounded rejection

Definition:

- the payment never becomes an on-chain transfer because it expires or violates
  a bounded execution constraint

Current system behavior:

- remains in the current lifecycle surfaces
- status is `EXPIRED`, `SLIPPAGE_EXCEEDED`, or `RAMP_FAILED`

Reason:

- this is still execution-state semantics, not a separate exception workflow

### 3. Post-broadcast execution failure

Definition:

- the instruction progressed beyond pure acceptance but did not cleanly reach
  intended settlement

Current system behavior:

- remains visible through `execution-status` and `finality-receipt`
- generic undisclosed failure remains `FAILED`

Future family impact:

- only escalates into an investigation case when cross-party follow-up is
  needed

### 4. Post-settlement remediation

Definition:

- the original payment is already economically final or treated as final enough
  that remediation requires a new transfer or off-chain refund

This is the first true exception-family object.

Design rule:

- do not represent this as the original payment changing from `FINAL` to some
  synthetic “reversed” status
- represent it as a linked remediation record

Recommended message analogue:

- `pacs.004`-like return or compensation object

### 5. Investigation and dispute handling

Definition:

- an operator needs structured follow-up without altering the original payment
  object

Examples:

- beneficiary credit query after chain finality
- mismatch between booked reporting and beneficiary handling
- Travel Rule dispute after an accepted record
- operational query around a failed or ambiguous transfer

Recommended message analogue:

- `camt.029`-like investigation case

## Recommended Family Boundaries

### Keep the current command surface narrow

The current instruction API should continue to own:

- quote
- submit
- get current instruction state
- pre-broadcast cancel

It should **not** become the container for:

- returns
- dispute narratives
- bilateral cancellation negotiation after execution has started

### Add a dedicated exception family later

Recommended future sub-families:

- `return_case` (`pacs.004` analogue)
- `investigation_case` (`camt.029` analogue)
- optional later `cancellation_case` (`camt.056` / `057` / `058` analogue)

## Proposed Object Model

### Shared exception identifiers

Every exception-family object should carry:

- `exception_case_id`
- `exception_type`
- `status`
- `opened_at`
- `updated_at`
- `related_instruction_id`
- `related_uetr`
- `related_travel_rule_record_id`
- `related_transaction_hash`
- `opened_by`
- `counterparty`
- `reason_code`
- `narrative`

This preserves the same traceability discipline already used across lifecycle
and reporting surfaces.

### Return case

Recommended fields:

- `return_case_id`
- `return_type`
- `original_instruction_id`
- `original_transaction_hash`
- `return_method`
- `return_amount`
- `return_asset`
- `return_status`
- `compensating_instruction_id` when remediation itself is executed through the
  stack
- `off_chain_reference` when remediation happens outside the chain flow

Recommended `return_method` values:

- `ON_CHAIN_COMPENSATING_TRANSFER`
- `OFF_CHAIN_REFUND`
- `MANUAL_FIAT_REMEDIATION`

### Investigation case

Recommended fields:

- `investigation_case_id`
- `case_type`
- `case_status`
- `priority`
- `requires_counterparty_action`
- `resolution_type`
- `resolution_summary`
- `linked_return_case_id` where relevant

Recommended `case_type` values:

- `STATUS_QUERY`
- `BENEFICIARY_CREDIT_QUERY`
- `TRAVEL_RULE_DISPUTE`
- `RETURN_REQUEST`
- `SETTLEMENT_DISCREPANCY`

### Cancellation case

This should remain a later addition only if the stack grows beyond the current
single-orchestrator command model.

If later implemented, it should cover:

- asynchronous bilateral cancellation request
- acceptance or rejection by the counterparty
- lapse/expiry of the cancellation request

For the current wedge, `DELETE /instruction/{instructionId}` remains enough.

## Status Rules

### Original payment stays authoritative

The original instruction should keep its real terminal outcome:

- `CANCELLED`
- `EXPIRED`
- `FAILED`
- `FINAL`

The exception-family object links to it; it does not overwrite it.

### Return cases do not rewrite finality

If a payment has reached `FINAL`, then:

- `execution-status` remains `FINAL`
- `finality-receipt` remains `FINAL`
- any remediation is represented as a separate return or compensating object

This is the single most important design rule in the family.

## Recommended Future Endpoints

When implementation starts, the first slice should likely be:

- `POST /exceptions/returns`
- `GET /exceptions/returns/:returnCaseId`
- `GET /exceptions/returns`
- `POST /exceptions/investigations`
- `GET /exceptions/investigations/:caseId`
- `GET /exceptions/investigations`

Hold for later:

- `POST /exceptions/cancellation-requests`
- `GET /exceptions/cancellation-requests/:caseId`

## Eventing Rule

The same push/poll discipline should apply here as elsewhere.

Recommended future event families:

- `return_case.updated`
- `investigation_case.updated`
- `cancellation_case.updated`

For each event:

- the push payload should equal the canonical polling object
- the transport envelope should add delivery metadata only

## First Implementation Order

When this family moves from design to implementation, the order should be:

1. `investigation_case`
2. `return_case`
3. `cancellation_case` only if bilateral orchestration really demands it

Reason:

- investigations are the safest addition because they preserve current payment
  objects and let operators track disputes without inventing fake reversals
- returns come next because they require remediation semantics but still fit the
  existing traceability model
- bilateral cancellation is the most workflow-heavy and least necessary for the
  current wedge

## Issue-Ready Follow-Ups

The design is ready to split into implementation issues:

1. Define `investigation_case` schema, statuses, and read/write surfaces.
2. Define `return_case` schema with compensating-transfer semantics.
3. Map exception-family identifiers into webhook and reporting traceability.
4. Decide whether bilateral cancellation is actually needed before adding a
   `cancellation_case` family.

## Non-Goals

This family should not:

- invent a fake chain reversal
- leak sanctions-specific internal reasoning
- replace `execution-status` or `finality-receipt`
- duplicate the full Travel Rule payload into every case object
