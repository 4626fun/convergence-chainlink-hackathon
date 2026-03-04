# CRE Runbook (4626)

## Prerequisites

- CRE CLI installed and authenticated (`cre login`)
- Bun installed
- Secrets set in CRE
- Working directory: repo root (`/home/akitav2/projects/4626`)

## Simulate

### Validate + typecheck first

```bash
bash cre/cre-workflows/scripts/validate-workflow-layout.sh
bash cre/cre-workflows/scripts/typecheck-workflows.sh
```

### Simulate all workflows (local-simulation)

```bash
CRE_SIMULATION_ENABLED=true bash cre/cre-workflows/scripts/simulate-workflows.sh
```

### Simulate runtime orchestration workflows (local-simulation)

All commands run from `cre/cre-workflows`:

```bash
# Export local secret placeholders for simulation
export KEEPR_API_KEY_VALUE="local-dev-key"
export KEEPR_API_BASE_URL_VALUE="http://127.0.0.1:8789/api"
export KEEPR_PRIVATE_KEY_VALUE="0x0000000000000000000000000000000000000000000000000000000000000001"
export CRE_RUNTIME_WEBHOOK_HMAC_SECRET_VALUE="local-hmac-secret"
export AWS_ACCESS_KEY_ID_VALUE="AKIALOCALTEST"
export AWS_SECRET_ACCESS_KEY_VALUE="local-secret"

# runtime-indexer-block (HTTP trigger)
cre workflow simulate runtime-indexer-block \
  --target local-simulation \
  --non-interactive \
  --trigger-index 0 \
  --http-payload @test-block.json

# runtime-indexer-data-fetch (Cron trigger)
cre workflow simulate runtime-indexer-data-fetch \
  --target local-simulation \
  --non-interactive \
  --trigger-index 0

# runtime-reference-feeds (Cron trigger)
cre workflow simulate runtime-reference-feeds \
  --target local-simulation \
  --non-interactive \
  --trigger-index 0

# runtime-orchestrator (Cron trigger)
cre workflow simulate runtime-orchestrator \
  --target local-simulation \
  --non-interactive \
  --trigger-index 0

# runtime-orchestrator (HTTP manual trigger)
cre workflow simulate runtime-orchestrator \
  --target local-simulation \
  --non-interactive \
  --trigger-index 1 \
  --http-payload @http_trigger_payload.json
```

### Engine logs (debug mode)

```bash
cre workflow simulate <workflow-name> --target local-simulation --engine-logs
```

### Non-interactive trigger selection

```bash
cre workflow simulate <workflow-name> --target local-simulation --non-interactive --trigger-index 0
```

- `trigger-index 0` is cron for all current workflows.
- For script-based runs:
  - `CRE_ENGINE_LOGS=true` enables engine logs
  - `CRE_TRIGGER_INDEX=<n>` overrides trigger index

## Deploy

```bash
cd cre/cre-workflows
cre workflow deploy <workflow-name> --target staging-settings
cre workflow deploy <workflow-name> --target production-settings
```

Capture returned workflow IDs and store them in ops metadata.

## Activate

```bash
cre workflow activate <workflow-id>
```

## Update

```bash
cre workflow update <workflow-id> --workflow-file <path/to/workflow.yaml> --target <target-name>
```

After update, verify whether workflow ID changed. If yes, update any allowlists/consumers that validate workflow identity.

## Pause

```bash
cre workflow pause <workflow-id>
```

## Delete

```bash
cre workflow delete <workflow-id>
```

## Secrets

```bash
cre secrets set KEEPR_API_KEY
cre secrets set KEEPR_API_BASE_URL
cre secrets set KEEPR_PRIVATE_KEY
```

Workflow mapping file: `cre/cre-workflows/secrets.yaml`

## Troubleshooting

- **Simulation fails with config/paths**
  - Run `bash cre/cre-workflows/scripts/validate-workflow-layout.sh`
- **Type errors across shared modules**
  - Run `bash cre/cre-workflows/scripts/typecheck-workflows.sh`
  - Ensure root shared dependency install succeeds in `cre/cre-workflows`
- **HTTP-trigger workflows need manual replay**
  - Fixtures are in `cre/cre-workflows/fixtures/http/`
    - `ajna-bucket-manager.manual.json`
    - `charm-rebalance-manager.manual.json`
    - `solana-orchestrator.manual.json`
  - CLI payload file paths are resolved relative to the selected workflow folder.
  - Use:
    - `cre workflow simulate ajna-bucket-manager --target local-simulation --non-interactive --trigger-index 1 --http-payload @../fixtures/http/ajna-bucket-manager.manual.json`
    - `cre workflow simulate charm-rebalance-manager --target local-simulation --non-interactive --trigger-index 1 --http-payload @../fixtures/http/charm-rebalance-manager.manual.json`
    - `cre workflow simulate solana-orchestrator --target local-simulation --non-interactive --trigger-index 1 --http-payload @../fixtures/http/solana-orchestrator.manual.json`
  - Add `--engine-logs` when diagnosing payload/trigger issues.
- **Log trigger not firing**
  - Verify watched addresses in `strategy-event-listener/config.*.json`
  - Confirm chain selector in `project.yaml` and workflow `chainName` alignment
- **Solana reconcile path not executing**
  - Check `/api/cre/keeper/solana/reconcile` auth header (`Bearer KEEPR_API_KEY`)
  - Verify `SOLANA_ORCHESTRATOR_URL` is configured
  - Inspect checkpoint table `keepr_workflow_checkpoints` for status (`completed`, `already_processed`, `failed`)
