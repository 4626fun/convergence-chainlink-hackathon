/**
 * CRE Workflow: Keepr Queue Executor
 *
 * Polls the Vercel API for pending keepr_actions, executes them via the
 * API, and updates their status. This is a pure HTTP workflow — no EVM
 * reads or writes.
 *
 * CRE Quota Budget (4 HTTP calls max per execution by default):
 *   1. GET  /keepr/actions/pending?limit=1         (1 call)
 *   2. POST /keepr/actions/updateStatus (claim)    (1 call)
 *   3. POST /keepr/actions/execute                 (1 call)
 *   4. POST /keepr/actions/updateStatus (finalize) (1 call)
 *   Total: 4 calls for 1 action
 *
 * To compensate for the reduced batch size (was 10, now 1), the cron
 * schedule runs every 30 seconds instead of every 5 minutes.
 */

import {
  CronCapability,
  HTTPClient,
  handler,
  Runner,
  type Runtime,
  type NodeRuntime,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"

// ---------------------------------------------------------------------------
// Config (loaded from config.staging.json / config.production.json)
// ---------------------------------------------------------------------------

type Config = {
  schedule: string
  apiBaseUrl: string
  maxActionsPerExecution: number
}

// ---------------------------------------------------------------------------
// Types matching the Vercel API responses
// ---------------------------------------------------------------------------

type PendingAction = {
  id: number
  vaultAddress: string
  groupId: string
  actionType: string | null
  action: Record<string, unknown>
  dedupeKey: string | null
  status: string
  attemptCount: number
  lastError: string | null
  createdAt: string
}

type PendingActionsResponse = {
  success: boolean
  data?: { actions: PendingAction[]; count: number }
  error?: string
}

type UpdateStatusResponse = {
  success: boolean
  data?: { updated: boolean }
  error?: string
}

type ExecuteResponse = {
  success: boolean
  data?: {
    executed: boolean
    retryable: boolean
    actionType: string
    error?: string
  }
  error?: string
}

// ---------------------------------------------------------------------------
// Result type returned by the workflow
// ---------------------------------------------------------------------------

type QueueResult = {
  processed: number
  succeeded: number
  failed: number
  retried: number
  skipped: number
}

const QUEUE_MAX_ATTEMPTS = 5
const RETRY_BASE_SECONDS = 60
const RETRY_MAX_SECONDS = 600

// ---------------------------------------------------------------------------
// HTTP helper — runs inside runInNodeMode for consensus
// ---------------------------------------------------------------------------

function encodeJsonBody(payload: unknown): string {
  const json = JSON.stringify(payload)
  if (typeof btoa === "function") return btoa(json)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeBuffer = (globalThis as any).Buffer
  if (maybeBuffer?.from) return maybeBuffer.from(json, "utf8").toString("base64")
  throw new Error("base64_encoder_unavailable")
}

function fetchPendingActions(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
): QueueResult {
  const baseUrl = nodeRuntime.config.apiBaseUrl
  const limit = nodeRuntime.config.maxActionsPerExecution

  // --- Call 1: Fetch pending actions ---
  const pendingResp = httpClient.sendRequest(nodeRuntime, {
    url: `${baseUrl}/keepr/actions/pending?limit=${limit}`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  }).result()

  const pendingBody = JSON.parse(
    new TextDecoder().decode(pendingResp.body),
  ) as PendingActionsResponse

  if (!pendingBody.success || !pendingBody.data) {
    return { processed: 0, succeeded: 0, failed: 0, retried: 0, skipped: 0 }
  }

  const actions = pendingBody.data.actions
  if (actions.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0, retried: 0, skipped: 0 }
  }

  const result: QueueResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    retried: 0,
    skipped: 0,
  }

  // Process up to maxActionsPerExecution actions
  // Each action uses 3 HTTP calls (claim + execute + finalize).
  for (const action of actions) {
    result.processed++

    // --- Call 2/4: Claim the action ---
    const claimResp = httpClient.sendRequest(nodeRuntime, {
      url: `${baseUrl}/keepr/actions/updateStatus`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: encodeJsonBody({ id: action.id, status: "executing" }),
    }).result()

    const claimBody = JSON.parse(
      new TextDecoder().decode(claimResp.body),
    ) as UpdateStatusResponse

    if (!claimBody.success || !claimBody.data?.updated) {
      // Another worker claimed it
      result.skipped++
      continue
    }

    // --- Call 3/5: Execute the action ---
    const execResp = httpClient.sendRequest(nodeRuntime, {
      url: `${baseUrl}/keepr/actions/execute`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: encodeJsonBody({
        id: action.id,
        vaultAddress: action.vaultAddress,
        groupId: action.groupId,
        actionType: action.actionType,
        action: action.action,
      }),
    }).result()

    const execBody = JSON.parse(
      new TextDecoder().decode(execResp.body),
    ) as ExecuteResponse

    if (execBody.success && execBody.data?.executed) {
      const doneResp = httpClient.sendRequest(nodeRuntime, {
        url: `${baseUrl}/keepr/actions/updateStatus`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: encodeJsonBody({ id: action.id, status: "executed" }),
      }).result()
      const doneBody = JSON.parse(
        new TextDecoder().decode(doneResp.body),
      ) as UpdateStatusResponse
      if (doneBody.success && doneBody.data?.updated) {
        result.succeeded++
      } else {
        result.failed++
      }
      continue
    }

    const retryable = execBody.data?.retryable ?? false
    const shouldRetry = retryable && action.attemptCount < (QUEUE_MAX_ATTEMPTS - 1)
    if (shouldRetry) {
      const retryDelaySeconds = Math.min(
        RETRY_MAX_SECONDS,
        RETRY_BASE_SECONDS * Math.pow(2, Math.max(0, action.attemptCount)),
      )
      const retryResp = httpClient.sendRequest(nodeRuntime, {
        url: `${baseUrl}/keepr/actions/updateStatus`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: encodeJsonBody({
          id: action.id,
          status: "retry",
          error: execBody.data?.error ?? execBody.error ?? "execution_failed",
          retryDelaySeconds,
        }),
      }).result()
      const retryBody = JSON.parse(
        new TextDecoder().decode(retryResp.body),
      ) as UpdateStatusResponse
      if (retryBody.success && retryBody.data?.updated) {
        result.retried++
      } else {
        result.failed++
      }
    } else {
      const failResp = httpClient.sendRequest(nodeRuntime, {
        url: `${baseUrl}/keepr/actions/updateStatus`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: encodeJsonBody({
          id: action.id,
          status: "failed",
          error: execBody.data?.error ?? execBody.error ?? "execution_failed",
        }),
      }).result()
      const failBody = JSON.parse(
        new TextDecoder().decode(failResp.body),
      ) as UpdateStatusResponse
      if (failBody.success && failBody.data?.updated) {
        result.failed++
      } else {
        result.skipped++
      }
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// CRE Callback — triggered by cron
// ---------------------------------------------------------------------------

const onCronTrigger = (runtime: Runtime<Config>): QueueResult => {
  // Retrieve the API key from CRE secrets
  const apiKeySecret = runtime.getSecret({ id: "KEEPR_API_KEY" }).result()
  const apiKey = apiKeySecret.value

  runtime.log("Keepr queue executor starting")

  // Run HTTP calls in node mode with identical aggregation
  // (all nodes should see the same API responses)
  const httpClient = new HTTPClient()
  const result = runtime.runInNodeMode(
    (nodeRuntime: NodeRuntime<Config>) =>
      fetchPendingActions(nodeRuntime, httpClient, apiKey),
    consensusIdenticalAggregation(),
  )().result()

  runtime.log(
    `Queue processing complete: processed=${result.processed} succeeded=${result.succeeded} failed=${result.failed} retried=${result.retried} skipped=${result.skipped}`,
  )

  return result
}

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
