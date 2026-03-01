# CRE Workflows — 4626

Chainlink Runtime Environment (CRE) workflows that automate critical onchain operations for the 4626 protocol.

**A single workflow manages every registered vault automatically.**

## Hackathon Submission Quick Links

- Requirement mapping: `docs/hackathon/chainlink-cre-submission.md`
- 3-5 minute walkthrough script: `docs/hackathon/video-script.md`
- Simulation evidence logs: `docs/hackathon/evidence/`
- Public-source packaging runbook: `docs/hackathon/public-source-packaging.md`

## Files Using Chainlink

Core CRE workflow files:
- `cre/cre-workflows/project.yaml`
- `cre/cre-workflows/keepr-queue/main.ts`
- `cre/cre-workflows/keepr-queue/workflow.yaml`
- `cre/cre-workflows/vault-keeper/main.ts`
- `cre/cre-workflows/vault-keeper/workflow.yaml`
- `cre/cre-workflows/auction-settlement/main.ts`
- `cre/cre-workflows/auction-settlement/workflow.yaml`
- `cre/cre-workflows/payout-integrity/main.ts`
- `cre/cre-workflows/payout-integrity/workflow.yaml`

CRE-to-app orchestration bridge files:
- `frontend/api/_handlers/cre/vaults/_active.ts`
- `frontend/api/_handlers/cre/keeper/_tend.ts`
- `frontend/api/_handlers/cre/keeper/_report.ts`
- `frontend/api/_handlers/cre/keeper/_sweep.ts`
- `frontend/api/_handlers/cre/keeper/_markSettled.ts`
- `frontend/api/_handlers/cre/keeper/_alert.ts`
- `frontend/api/_handlers/cre/keeper/_aiAssess.ts`
- `frontend/api/_handlers/_routes.ts`
- `frontend/server/agent/eliza/llm.ts`

## Simulation-First Proof (Hackathon)

All commands below were run from `cre/cre-workflows` and logs were saved under `docs/hackathon/evidence`.

```bash
# Terminal A: start local mock API bridge
set -a && source .env && set +a
node ../scripts/hackathon/mock-cre-api-server.mjs

# Terminal B: DeFi + AI orchestration proof
cre workflow simulate ./payout-integrity --target local-simulation \
  | tee ../../docs/hackathon/evidence/cre-payout-integrity-local-simulation.log

# Terminal B: Queue orchestration proof
cre workflow simulate ./keepr-queue --target local-simulation \
  | tee ../../docs/hackathon/evidence/cre-keepr-queue-local-simulation.log
```

Expected output highlights:
- `payout-integrity`: `AI assessment: enabled=true verdict=critical confidence=0.93`
- `payout-integrity`: `alertsSent: 2` with deterministic alerts in result payload
- `keepr-queue`: `processed=0 succeeded=0 failed=0 retried=0 skipped=0`

## What It Does

Every 5 minutes, the unified `4626` workflow runs three tasks in sequence:

| Task | What | Impact |
|------|------|--------|
| **Vault Keeper** | Deploy idle funds (`tend`), harvest yields (`report`) | Revenue |
| **Auction Settlement** | Settle graduated CCA auctions (`sweepCurrency`, `sweepUnsoldTokens`) | Feature |
| **Keepr Queue** | Process pending XMTP group ops + Neynar/Farcaster actions | Infrastructure |

### Payout Integrity Monitor

A dedicated CRE workflow runs every 30 minutes to verify the full fee pipeline:

| Check | What | Severity |
|-------|------|----------|
| **payoutRecipient** | Creator Coin's `payoutRecipient()` == GaugeController | Critical |
| **BPS Config** | `burnShareBps + lotteryShareBps + creatorShareBps + protocolShareBps == 10000` | Critical |
| **Vault Wiring** | GaugeController's `vault()` matches registered vault | Critical |
| **Burn Stream** | Active epoch not stale (>24h without `drip()`) | Warning |
| **Gauge Balance** | GaugeController holds shares and `lastDistribution` is fresh | Warning |

Alerts are sent to `POST /api/cre/keeper/alert` and forwarded to the configured webhook.

### Settlement Tracking

Auction settlement is a one-time event (~7 days after deployment). The system tracks:

- `graduated_at` — when `isGraduated()` first returns true
- `settled_at` — after successful `sweepCurrency()` + `sweepUnsoldTokens()`

Once settled, vaults are excluded from the auction-settlement workflow to avoid wasting CRE quota on redundant reads. The `sweepCurrencyBlock` on-chain check provides a secondary guard against double-sweeping.
## Solana Workflows

The Solana integration runs as separate workflows (cron-driven, independent from the unified 4626 runner):

| Workflow | What | Schedule |
|----------|------|----------|
| **keepr-solana-entry-relay** | Drain PendingEntries PDAs + relay entries to Base | 30s |
| **keepr-solana-fee-flush** | Harvest TransferFeeConfig fees + forward to Base gauge | 5m |
| **keepr-solana-winner-relay** | Relay Base winners to Solana WinnerRecord PDA | 1m |
| **keepr-solana-graduation** | Close Alpha Vault when Base CCA graduates | 1m |
| **keepr-solana-price-monitor** | Monitor DLMM price + recenter on deviation | 1m |

Required env vars for Solana workflows (see `secrets.example.env`):
- `SOLANA_RPC_URL`
- `SOLANA_KEEPER_KEYPAIR` or `SOLANA_KEEPER_KEYPAIRS`
- `SOLANA_KEEPER_PUBKEY`
- `SOLANA_CREATOR_MINTS`
- `SOLANA_SHARE_OFT_MAPPING`
- `SOLANA_BRIDGE_ADAPTER`
- `LOTTERY_MANAGER`

## Solana Launch Scripts

TypeScript launch helpers for DLMM + Alpha Vault:

```bash
# Create DLMM pool (requires DLMM_* env vars)
npm run solana:create-dlmm-pool

# Create Pro Rata Alpha Vault (requires ALPHA_VAULT_* env vars)
npm run solana:create-alpha-vault
```

## Solana Authority Lifecycle

Phase A/B/C authority actions (Token-2022 mint + program upgrade authority):

```bash
# Phase A: move mint authorities to multisig
AUTHORITY_TYPES=mint_tokens,transfer_fee_config,withheld_withdraw,transfer_hook_program_id \
NEW_AUTHORITY=MultisigPubkey \
npm run solana:set-token-authority

# Phase B: revoke hook reassignment authority
AUTHORITY_TYPES=transfer_hook_program_id NEW_AUTHORITY=none \
npm run solana:set-token-authority

# Phase C: revoke program upgrade authority (optional)
NEW_UPGRADE_AUTHORITY=none npm run solana:set-program-upgrade-authority
```

## Token Badge Applications

Prepare application payloads for Meteora/Orca support:

```bash
BADGE_TARGET=meteora npm run solana:prepare-token-badge
BADGE_TARGET=orca npm run solana:prepare-token-badge
```

## Solana Deployment Scripts

Program + mint setup, PDA initialization, and supply bridging:

```bash
# Upgrade Anchor program (uses solana CLI)
npm run solana:upgrade-program

# Create Token-2022 mint (TransferFeeConfig + TransferHook)
npm run solana:create-token-2022-mint

# Initialize CreatorConfig + PendingEntries + WinnerRecord + ExtraAccountMetaList
npm run solana:init-creator-pdas

# Bridge initial supply to Solana
npm run solana:bridge-supply
```

## Architecture

### Legacy Runner (local `tsx runner.ts`)

```
cron (*/5 * * * *)
    │
    ▼
┌──────────────────────┐
│  4626.workflow.ts     │
│  (unified entrypoint) │
└──────────┬───────────┘
           │
    ┌──────┼──────────────────┐
    ▼      ▼                  ▼
 Vault   Auction           Keepr
 Keeper  Settlement        Queue
    │      │                  │
    ▼      ▼                  ▼
 Onchain  Onchain          HTTP API
 (viem)   (viem)           (Vercel)
    │      │                  │
    └──────┴──────────────────┘
           │
    ┌──────┴──────┐
    ▼             ▼
 Registry API   Alerts
 (vault list)   (webhook)
```

### CRE SDK Workflows (Chainlink DON)

```
Chainlink DON
    │
    ├── keepr-queue (every 30s)
    │       └── HTTPClient → Vercel API
    │
    ├── vault-keeper (every 5m)
    │       ├── EVMClient → read vault state (Base)
    │       └── HTTPClient → POST /cre/keeper/tend|report
    │
    ├── auction-settlement (hourly, unsettled vaults only)
    │       ├── HTTPClient → GET /cre/vaults/active?settled=false
    │       ├── EVMClient → currentAuction, isGraduated, sweepCurrencyBlock
    │       ├── HTTPClient → POST /cre/keeper/sweep
    │       └── HTTPClient → POST /cre/keeper/mark-settled
    │
    └── payout-integrity (every 30m)
            ├── HTTPClient → GET /cre/vaults/active
            ├── EVMClient → payoutRecipient, BPS x4, vault, lastDistribution,
            │                burnStream x3, balanceOf
            └── HTTPClient → POST /cre/keeper/alert (on failure)
```

The CRE workflows use an **HTTP bridge pattern**: on-chain reads happen
directly via `EVMClient`, but writes are delegated to Vercel API endpoints
that execute transactions using the keeper wallet. This is because CRE's
native write model uses a report-and-forwarder pattern requiring consumer
contracts implementing `IReceiver.onReport()`, which is planned for Phase 4.

## Setup

### 1. Create `.env`

```bash
cp secrets.example.env .env
```

Required:
- `KEEPR_PRIVATE_KEY` — EOA private key for the keeper wallet
- `BASE_RPC_URL` — Base mainnet RPC
- `KEEPR_API_BASE_URL` — Your deployment (e.g. `https://4626.fun/api`)
- `KEEPR_API_KEY` — API key for CRE-to-Vercel auth

Optional (ERC-4337 smart wallet mode):
- `CRE_ERC4337_ENABLED=true`
- `CRE_ERC4337_SMART_WALLET` — canonical smart wallet address (UserOp sender)
- `CRE_ERC4337_BUNDLER_URL` — bundler endpoint (CDP or compatible)
- `CRE_ERC4337_PAYMASTER_URL` — paymaster endpoint (optional)
- `CRE_ERC4337_OWNER_PRIVATE_KEY` — EOA signer for UserOps (must be an onchain owner)
- `CRE_ERC4337_VERSION` — Coinbase Smart Wallet version (`1` or `1.1`)
- `CRE_ERC4337_PRIVY_WALLET_ID` — use Privy Wallet API for signing
- `CRE_ERC4337_OWNER` — owner address (required for Privy signer)
- `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_WALLET_AUTHORIZATION_KEY` — required for Privy signer

Optional (alerting):
- `KEEPR_ALERT_WEBHOOK_URL` — webhook URL for payout-integrity and settlement alerts
### 2. Register Vaults

Each vault is registered via `POST /api/keepr/vault/upsert`. Include contract addresses in `config_json`:

```json
{
  "contracts": {
    "ccaStrategy": "0x...",
    "gaugeController": "0x...",
    "burnStream": "0x..."
  }
}
```

- **Vault Keeper** processes every registered vault (only needs `vault_address`)
- **Auction Settlement** only processes vaults with `contracts.ccaStrategy` that are not yet settled
- **Payout Integrity** only processes vaults with `contracts.gaugeController`
- **Keepr Queue** processes all pending actions regardless of vault

### 3. Authorize the Keeper

```bash
# Per vault — authorize the keeper wallet
cast send $VAULT --rpc-url $RPC "setKeeper(address)" $KEEPER_ADDRESS
```

If ERC-4337 is enabled, `KEEPER_ADDRESS` must be the smart wallet
(`CRE_ERC4337_SMART_WALLET`). Otherwise, use the EOA derived from
`KEEPR_PRIVATE_KEY`.

Auction settlement is permissionless — no auth needed.

### 4. Fund the Keeper

Send **0.1 ETH** to the keeper wallet on Base.

## Running

```bash
cd cre
npm install

# Run everything
npm start

# Dry-run (simulates onchain writes)
npm run dry-run

# Run individual tasks
npm run start:vault-keeper
npm run start:auction-settlement
npm run start:keepr-queue

# Tests
npm test
```

## Directory Structure

```
cre/
├── config.ts                           # ABIs, timing constants
├── runner.ts                           # Local CLI runner (legacy)
├── package.json
│
├── cre-workflows/                      # ← Official CRE SDK project
│   ├── project.yaml                    # CRE project config (RPC, targets)
│   ├── secrets.yaml                    # CRE secrets references
│   ├── .env                            # Local simulation secrets
│   ├── .gitignore                      # Excludes .wasm, .cre/, .env
│   ├── contracts/abi/                  # Shared ABI exports
│   │   ├── Vault.ts
│   │   ├── CCAStrategy.ts
│   │   ├── GaugeController.ts
│   │   ├── BurnStream.ts
│   │   ├── CreatorCoin.ts
│   │   ├── ERC20.ts
│   │   └── index.ts
│   ├── keepr-queue/                    # HTTP-only queue processor
│   │   ├── main.ts                     # CRE workflow (CronCapability + HTTPClient)
│   │   ├── workflow.yaml
│   │   ├── config.staging.json
│   │   ├── config.production.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── vault-keeper/                   # EVM reads + HTTP bridge writes
│   │   ├── main.ts                     # CRE workflow (EVMClient + HTTPClient)
│   │   ├── workflow.yaml
│   │   ├── config.staging.json
│   │   ├── config.production.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── auction-settlement/             # Smart polling (hourly, DB-tracked)
│   │   ├── main.ts                     # CRE workflow (EVMClient + HTTPClient)
│   │   ├── workflow.yaml
│   │   ├── config.staging.json
│   │   ├── config.production.json
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── payout-integrity/              # Fee pipeline monitor (every 30m)
│       ├── main.ts                     # CRE workflow (EVMClient + HTTPClient)
│       ├── workflow.yaml
│       ├── config.staging.json
│       ├── config.production.json
│       ├── package.json
│       └── tsconfig.json
│
├── workflows/                          # Legacy runner workflows
│   ├── 4626.workflow.ts                # Unified entrypoint (runs all 3)
│   ├── vault-keeper.workflow.ts        # Standalone vault keeper
│   ├── auction-settlement.workflow.ts  # Standalone auction settlement
│   └── keepr-queue-executor.workflow.ts
├── actions/
│   ├── vault-keeper.action.ts          # tend/report logic (multi-vault)
│   ├── auction-settlement.action.ts    # sweep logic (multi-vault, sweepCurrencyBlock guard)
│   └── keepr-queue-executor.action.ts  # XMTP/Neynar queue processor
├── utils/
│   ├── onchain.ts                      # viem clients, read/write/dry-run
│   ├── registry.ts                     # Vault registry client
│   └── alerts.ts                       # Webhook alerting
├── tests/
│   ├── vault-keeper.test.ts
│   └── auction-settlement.test.ts
└── secrets.example.env
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/cre/vaults/active` | GET | Returns all registered vaults (supports `?settled=false` filter) |
| `/api/cre/keeper/tend` | POST | HTTP bridge — calls `tend()` on a vault |
| `/api/cre/keeper/report` | POST | HTTP bridge — calls `report()` on a vault |
| `/api/cre/keeper/sweep` | POST | HTTP bridge — calls `sweepCurrency()` + `sweepUnsoldTokens()` |
| `/api/cre/keeper/mark-settled` | POST | Records `graduated_at` / `settled_at` timestamps in DB |
| `/api/cre/keeper/alert` | POST | Receives alerts from CRE workflows, forwards to webhook |
| `/api/cre/keeper/aiAssess` | POST | AI advisory classification endpoint for payout-integrity (deterministic checks remain authoritative) |
| `/api/keepr/actions/pending` | GET | Returns pending queue actions |
| `/api/keepr/actions/updateStatus` | POST | Updates action status |

All require `Authorization: Bearer $KEEPR_API_KEY`.

## CRE SDK Workflows

### Prerequisites

1. **CRE CLI** installed (`cre version` should return v1.0.10+)
2. **Bun** v1.0+ installed
3. **CRE account** — run `cre login` to authenticate

### Running CRE Workflows

```bash
# Install dependencies for a workflow
cd cre/cre-workflows/keepr-queue && bun install

# Simulate locally (requires cre login)
cd cre/cre-workflows
cre workflow simulate keepr-queue --target local-simulation
cre workflow simulate vault-keeper --target local-simulation
cre workflow simulate auction-settlement --target local-simulation
cre workflow simulate payout-integrity --target local-simulation

# Deploy to DON (requires cre login + funded account)
cre workflow deploy keepr-queue --target production-settings
cre workflow deploy payout-integrity --target production-settings
```

### CRE Secrets

Set secrets before deploying:

```bash
cre secrets set KEEPR_API_KEY
cre secrets set KEEPR_API_BASE_URL
cre secrets set KEEPR_PRIVATE_KEY
```

For local simulation, add these to `cre/cre-workflows/.env`.

### CRE Quota Constraints

| Resource | Limit | Impact |
|----------|-------|--------|
| EVM reads | 10 per execution | vault-keeper: 1 vault per run; payout-integrity: 1 vault per run |
| HTTP calls | 5 per execution | keepr-queue: 2 actions per run |
| Cron interval | 30s minimum | keepr-queue uses 30s; auction-settlement uses 1h |
| Concurrent capabilities | 3 | Sequential reads within each workflow |
| Execution timeout | 5 minutes | All workflows complete well within this |

### CRE Quota Budget

**auction-settlement (hourly)**:
- 1 HTTP (fetch unsettled vaults) + 3 EVM reads (currentAuction, isGraduated, sweepCurrencyBlock) + 1 HTTP (sweep) + 1 HTTP (mark-settled) = 3 HTTP + 3 EVM reads

**payout-integrity (every 30 min, 1 vault per run)**:
- 1 HTTP (fetch vaults) + ~10 EVM reads (payoutRecipient, BPS x4, vault, lastDistribution, burnStream x3, balanceOf) + 1 HTTP (alert if needed) = 2 HTTP + 10 EVM reads

### HTTP Bridge Pattern

CRE workflows cannot directly write to contracts (CRE uses a report-and-forwarder
model). Instead, the workflows delegate writes to Vercel API endpoints:

```
CRE Workflow → HTTPClient.sendRequest(POST /cre/keeper/tend) → Vercel API → viem writeContract → Base
```

The bridge endpoints authenticate with `KEEPR_API_KEY` and use the keeper wallet
(`KEEPR_PRIVATE_KEY`) to submit transactions.

**Phase 4 (Future)**: Deploy `VaultKeeperReceiver` and `AuctionSettlementReceiver`
Solidity contracts implementing `IReceiver.onReport()` to enable native CRE writes
via `runtime.report()` + `evmClient.writeReport()`, removing the HTTP bridge.
