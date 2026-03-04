# CRE Runtime Hardening Checklist

## 1) Secrets and auth hygiene

- Store workflow secrets in CRE Secrets only:
  - `KEEPR_API_KEY`
  - `CRE_RUNTIME_WEBHOOK_HMAC_SECRET`
  - `AWS_ACCESS_KEY_ID`
  - `AWS_SECRET_ACCESS_KEY`
- Keep local-only simulation values in `cre/cre-workflows/.env` (never commit real values).
- Require `Authorization: Bearer ${KEEPR_API_KEY}` for all bridge endpoints.
- Enable optional HMAC header verification (`x-cre-timestamp`, `x-cre-nonce`, `x-cre-signature`) when clients support signed requests.
- Rotate `CRE_HTTP_TRIGGER_PRIVATE_KEY` on a regular schedule and after incidents.

## 2) Replay protection and idempotency

- Require an `idempotencyKey` in all ingest/decision payloads.
- Persist idempotency in DB unique keys:
  - `cre_runtime_records (workflow, kind, idempotency_key)`
  - `cre_runtime_decisions (workflow, idempotency_key)`
- Enforce nonce one-time use in `cre_runtime_replay_nonces`.
- Use deterministic idempotency keys derived from stable payload hashes.

## 3) Observability

- Emit structured logs (JSON) for:
  - ingest accepted/rejected
  - decision stored + enqueue status
  - trigger dispatch status (`statusCode`, `requestId`)
- Include `correlationId` on every request path.
- Track operational counters:
  - records inserted vs updated (duplicate replay)
  - decision inserts
  - trigger failures by status code class

## 4) Reorg and finality strategy

- Feed reads use `LAST_FINALIZED_BLOCK_NUMBER` for deterministic finality.
- For indexed block/transaction payloads:
  - store `blockNumber`, `blockHash`, transaction hash
  - avoid irreversible side effects until checkpoint progression confirms expected sequence.
- Keep orchestrator checkpoint advancement monotonic (`next = max(previous, latest)`).

## 5) Retries, rate limits, and backoff

- Use deterministic retry schedule where applicable (slot/checkpoint based).
- Keep manual replay path available through runtime HTTP trigger with locked auth.
- Respect CRE quotas:
  - trigger rate limits
  - capability call limits
  - execution timeout
- For app-side trigger dispatch, treat non-2xx as retryable based on policy and avoid tight retry loops.

## 6) Deterministic execution safeguards

- No `Promise.race` / `Promise.any`.
- No unsorted object key iteration in decision logic.
- No `Date.now()` in workflow decisions; use `runtime.now()`.
- Keep capability call ordering fixed.
- In QuickJS/WASM workflow runtime paths, avoid Node built-ins and Node SDKs.

## 7) Promotion flow (simulation -> staging -> production)

1. Local simulation
   - Run all workflow simulate commands and collect result logs.
2. Staging deploy
   - Deploy with `--target staging-settings`.
   - Run controlled payload replay on staging endpoints.
   - Verify DB writes and idempotency behavior.
3. Production deploy
   - Deploy with `--target production-settings`.
   - Activate incrementally and monitor ingest/decision/trigger logs.
4. Post-deploy checks
   - Validate checkpoint progression and decision idempotency.
   - Validate nonce replay rejection and auth headers.
