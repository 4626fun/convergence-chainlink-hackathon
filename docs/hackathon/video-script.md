# 3-5 Minute Demo Script (Chainlink CRE Submission)

Target length: **4 minutes**

## 0:00 - 0:25 — Intro

1. “This is 4626, and we’re using Chainlink CRE as an orchestration layer for protocol operations.”
2. “Today I’ll lead with our Solana workflow path, then show the Chainlink CRE simulation proof.”
3. Show `cre/README.md` and point to **Files Using Chainlink**.

## 0:25 - 1:10 — Solana Workflow Spotlight

1. Open `cre/workflows/keepr-solana-price-monitor.workflow.ts`.
2. Open `cre/actions/keepr-solana-price-monitor.action.ts`.
3. Call out:
   - Base oracle vs Solana DLMM pricing
   - Deviation thresholds (alert/recenter/halt)
   - Derived metrics: `creator / 1 SOL` from oracle and DLMM paths
4. Open `frontend/server/agent/eliza/plugins/cre/index.ts` and point to `/cre solana`.

## 1:10 - 1:50 — Show Operator UX (`/cre solana`)

1. In chat/operator UI, run `/cre solana` and show the response.
2. Call out:
   - `Base oracle` price
   - `Solana DLMM` price
   - `Oracle implied` and `DLMM implied` creator-per-SOL
   - `Deviation` and `Action`

## 1:50 - 2:15 — Solana Monitor Test Proof (non-mutating)

From repo root:

```bash
pnpm -C cre exec vitest run tests/keepr-solana-price-monitor.test.ts
```

Narration points:
1. “This validates the Solana monitor path and formatting/derived metrics.”
2. “It is read-oriented and safe to run in demo.”

## 2:15 - 3:10 — Chainlink CRE CLI Simulation Proof (required)

From `cre/cre-workflows`:

```bash
set -a && source .env && set +a
node ../scripts/hackathon/mock-cre-api-server.mjs

cre workflow simulate ./payout-integrity --target local-simulation
cre workflow simulate ./keepr-queue --target local-simulation
```

Narration points:
1. “This is the explicit CRE CLI simulation proof for submission.”
2. “`payout-integrity` shows deterministic checks plus AI advisory fields.”
3. “`keepr-queue` shows successful orchestration metrics.”

## 3:10 - 3:45 — Show Evidence Bundle + Requirement Mapping

Open:
- `docs/hackathon/evidence/cre-payout-integrity-local-simulation.md`
- `docs/hackathon/evidence/cre-keepr-queue-local-simulation.md`
- `docs/hackathon/chainlink-cre-submission.md`

Say:
1. “These are the simulation-first proof artifacts for judges.”
2. “This checklist maps each requirement to exact files and outputs.”

## 3:45 - 4:00 — Wrap

1. “This project demonstrates Solana operational monitoring, plus Chainlink CRE orchestration across onchain reads, external APIs, and AI-assisted analysis.”
2. “All source and docs are prepared for public submission, with secrets excluded.”
