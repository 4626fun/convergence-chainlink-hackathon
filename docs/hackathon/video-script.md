# 3-5 Minute Demo Script (Chainlink CRE Submission)

Target length: **4 minutes**

## 0:00 - 0:30 — Intro

1. “This is 4626, and we’re using Chainlink CRE as an orchestration layer for protocol operations.”
2. “Today I’ll show two simulated workflows: DeFi orchestration and CRE + AI advisory analysis.”
3. Show `cre/README.md` and point to **Files Using Chainlink**.

## 0:30 - 1:10 — Architecture Snapshot

1. Open `cre/cre-workflows/payout-integrity/main.ts`.
2. Call out:
   - `CronCapability` trigger
   - `EVMClient` reads (onchain state checks)
   - `HTTPClient` bridge calls
3. Open `frontend/api/_handlers/cre/keeper/_aiAssess.ts`.
4. Explain: AI output is advisory only; deterministic checks remain source of truth.

## 1:10 - 2:40 — Run CRE + AI Simulation

From `cre/cre-workflows`:

```bash
set -a && source .env && set +a
node ../scripts/hackathon/mock-cre-api-server.mjs

cre workflow simulate ./payout-integrity --target local-simulation
```

Narration points:
1. “The workflow executes deterministic onchain checks, then calls the AI assessment endpoint.”
2. “We can see `aiEnabled`, `aiVerdict`, and `aiConfidence` in the simulation result.”
3. “Deterministic alerts are still emitted and sent through `/api/cre/keeper/alert`.”

## 2:40 - 3:25 — Run DeFi/Queue Orchestration Simulation

```bash
cre workflow simulate ./keepr-queue --target local-simulation
```

Narration points:
1. “This shows CRE orchestrating protocol queue operations through the HTTP bridge.”
2. “Execution result is successful with no failed actions.”

## 3:25 - 3:50 — Show Evidence Bundle

Open:
- `docs/hackathon/evidence/cre-payout-integrity-local-simulation.md`
- `docs/hackathon/evidence/cre-keepr-queue-local-simulation.md`
- `docs/hackathon/chainlink-cre-submission.md`

Say:
1. “These logs are the simulation-first proof artifacts.”
2. “This checklist maps each requirement to concrete files and outputs.”

## 3:50 - 4:00 — Wrap

1. “This project demonstrates CRE orchestration across onchain reads, external APIs, and AI-assisted analysis.”
2. “All source and docs are prepared for public submission, with secrets excluded.”
