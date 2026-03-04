# CRE Template Mapping (Locked Adaptation Boundaries)

This file defines the allowed source templates and adaptation boundaries for the runtime orchestration layer.

## Workflow -> template source

- `runtime-indexer-block`
  - Primary source:
    - `building-blocks/indexer-block-trigger/block-trigger-ts/workflow/main.ts`
    - `building-blocks/indexer-block-trigger/block-trigger-ts/workflow/test-block.json`
  - Allowed adaptation:
    - Add deterministic ordering and normalized output fields.
    - Add authenticated HTTP sink call to app bridge.
    - Add checkpoint persistence hooks through shared KV helper.
  - Not allowed:
    - Replace HTTP trigger with non-template trigger types in v1.

- `runtime-indexer-data-fetch`
  - Primary source:
    - `building-blocks/indexer-data-fetch/indexer-fetch-ts/workflow/main.ts`
    - `building-blocks/indexer-data-fetch/indexer-fetch-ts/workflow/config/config.staging.json`
  - Allowed adaptation:
    - Canonicalize GraphQL request ordering.
    - Add HTTP sink call to app bridge.
    - Add deterministic run digest checkpointing.
  - Not allowed:
    - Introduce nondeterministic fallback races (`Promise.race`, `Promise.any`).

- `runtime-reference-feeds`
  - Primary source:
    - `building-blocks/read-data-feeds/read-data-feeds-ts/my-workflow/main.ts`
    - `building-blocks/read-data-feeds/read-mvr-data-feeds-ts/my-workflow/main.ts`
  - Allowed adaptation:
    - Merge regular feed + MVR reads in one workflow.
    - Add HTTP sink call to app bridge.
    - Keep reads pinned to `LAST_FINALIZED_BLOCK_NUMBER`.
  - Not allowed:
    - Block reads at non-finalized block heights for production logic.

- `runtime-orchestrator`
  - Primary source:
    - `building-blocks/kv-store/kv-store-ts/my-workflow/main.ts`
    - `starter-templates/tokenized-asset-servicing/asset-log-trigger-workflow/main.ts`
    - `starter-templates/bring-your-own-data/workflow-ts/{por,nav}/main.ts`
  - Allowed adaptation:
    - Reuse pure JS SigV4 KV state pattern.
    - Reuse dual trigger pattern (cron + HTTP manual).
    - Reuse field-level aggregation style for deterministic numeric decision inputs.
  - Not allowed:
    - Node-only SDK dependencies in workflow runtime code.

## Runtime constraints (TypeScript in CRE)

- TS workflows run in QuickJS compiled to WASM.
- Do not use Node built-ins in CRE runtime code paths (`node:crypto`, `node:http`, `stream`, AWS SDK).
- Use pure JS signing/hashing patterns (`@noble/hashes`) for SigV4.
- Use fixed execution order and explicit aggregation calls.

## App bridge pattern source

- Pattern source:
  - `starter-templates/tokenized-asset-servicing` HTTP bridge and trigger wiring.
- Repo-local canonical style:
  - `frontend/api/_handlers/cre/keeper/*.ts`
  - `frontend/api/_handlers/_routes.ts`
  - `frontend/server/_lib/keeprSchema.ts` and idempotent checkpoint table style from `cre/keeper/solana/reconcile`.
