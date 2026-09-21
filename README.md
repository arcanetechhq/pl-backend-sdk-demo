# Stellar Privacy SDK backend demo

Reference NestJS app that runs `@arcanetech/privacy-sdk-stellar/node` on the server. It derives HD testnet accounts, funds them with Friendbot, deposits native XLM into the privacy pool if the private balance is empty, then sends private transfers through a relayer-service on a timer.

No browser wallet. All SDK calls happen in Node. The dashboard is read-only.

## What you need

- Docker (recommended) or Node 20 + Postgres 16
- Live stand values: pool, registry, KYT inspect API (same origin as the payment client `VITE_API_BASE_URL`), `APPLICATION_ID` as `association.audit_id` (decimal Fr, not a Compliance UUID), audit public key, `zkConfigNonce`
- A BIP-39 `STELLAR_MNEMONIC` (secrets stay in env, not in the database)

Tutorial fixture contract IDs from the public docs will not confirm on testnet. Use the same stand as your payment UI.

On `npm run start:dev` the process:

1. Sets up HD accounts (Friendbot + registry) if needed
2. Deposits `DEPOSIT_AMOUNT_XLM` from account 0 when that account has no unspent private notes
3. Sends private transfers every `TX_INTERVAL_MINUTES` (default 30), each for `TX_AMOUNT_XLM`
4. Serves a live viewer for status, balances, volume, and the operation log

## Local Node

Start Postgres (or `docker compose up postgres`), set `DATABASE_URL` to `localhost`, then:

```bash
npm install
npm run start:dev
```

Run the relayer the same way from `relayer-service`. Point `RELAYER_ORIGIN` at `http://localhost:3010/api`.

## Simulator env

| Variable | Default | Role |
| --- | --- | --- |
| `TX_INTERVAL_MINUTES` | `30` | Minutes between private transfers |
| `TX_AMOUNT_XLM` | `1` | Amount of each private transfer |
| `DEPOSIT_AMOUNT_XLM` | `10` | One-time deposit from account 0 when private balance is empty |

## API

- `GET /api/state` — dashboard snapshot (status, interval, accounts, paginated log)

## Notes

- Private-sender transfers go to `relayer-service` via `@arcanetech/privacy-sdk-relay`. Deposit uses Direct Submission (`execute()`).
- Incoming notes for other HD accounts are remapped onto the recipient G-address after each transfer (delivery step).
- SDK domain state is a JSONB snapshot of the official in-memory adapter. Restart keeps notes and simulator counters.
- If a live step cannot be done through the public SDK, stop and treat it as an SDK gap — do not add workarounds that hide missing APIs.
