# pacs.crypto Chain Adapter Contract

This document defines the current chain-adapter seam for the executable
reference stack.

The goal is not to model every future chain integration today. The goal is to
keep the API layer stable while letting lifecycle realism move from:

- simulated adapter
- to testnet adapter
- to later production-facing adapter work

without redesigning the route layer.

## Current Contract

An adapter is identified by:

- `id`
- `mode`
- `chain_family`

The current normalized contract supports these methods:

- `hasExpired(expiryDateTime)`
- `buildFeeEstimate(request)`
- `buildQuoteResponse(request)`
- `normalizeOnChainSettlement(onChainSettlement, amount, input)`
- `getLifecycleTimestamp(record, status)`
- `deriveLifecycleState(record)`
- `describeLifecycle(input)`

`buildApp()` now normalizes the supplied adapter against the default mock EVM
adapter. That means later adapters can override only the methods they need
while the remaining behavior stays stable.

## Current Ownership Boundary

The adapter now owns:

- quote realism
- fee estimate modeling
- settlement defaults
- lifecycle advancement
- lifecycle timestamps
- lifecycle metadata returned to clients

The route and storage layers no longer own these concerns directly.

## Metadata Surfaces

Adapter-derived metadata is now surfaced through existing reads rather than new
endpoints.

Current surfaces:

- `POST /instruction/quote`
- `POST /instruction`
- `GET /instruction/{instructionId}`
- `GET /execution-status/{instructionId}`
- `GET /execution-status/uetr/{uetr}`
- `GET /finality-receipt/{instructionId}`
- `GET /finality-receipt/uetr/{uetr}`

The metadata is exposed as `adapter_metadata`.

The current mock EVM adapter publishes:

- adapter identity and mode
- chain family and `chain_dli`
- congestion and lifecycle timing policy
- confirmation threshold policy
- fee-model assumptions

This gives later testnet work a stable place to expose chain-specific execution
context without widening the API family.

## Current Default Adapter

The default adapter is `mock-evm`.

It remains simulated, but it now models:

- amount-aware fee estimates
- ramp-aware slippage checks
- confirmation thresholds
- probabilistic to final settlement progression
- deterministic transaction and block references

## Swap-In Rule For Testnet Work

Future testnet work should respect these rules:

- keep the existing route shapes
- preserve `execution-status` and `finality-receipt` as the canonical read models
- replace adapter internals before touching route contracts
- use `adapter_metadata` for execution context rather than inventing separate per-chain status objects

That is the boundary that keeps the current wedge narrow and credible.

## Current Next Target

The active backlog now assumes:

- first real chain target: `Ethereum Sepolia`
- first real asset: `USDC on Sepolia`
- first real execution mode: `FULL_CUSTODY`

Those defaults should be treated as the first testnet adapter target unless the
program of record is intentionally changed.
