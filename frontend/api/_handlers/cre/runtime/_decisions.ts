import type { VercelRequest, VercelResponse } from "@vercel/node"

import {
  type ApiEnvelope,
  handleOptions,
  readJsonBody,
  setCors,
  setNoStore,
} from "../../../../server/auth/_shared.js"
import {
  authenticateRuntimeRequest,
  maybeEnqueueRuntimeAction,
  storeRuntimeDecision,
} from "../../../../server/_lib/cre/runtimeBridge.js"
import { logger } from "../../../../server/_lib/logger.js"

type EnqueueActionBody = {
  vaultAddress?: string
  groupId?: string
  actionType?: string
  action?: Record<string, unknown>
  dedupeKey?: string | null
}

type DecisionBody = {
  workflow?: string
  idempotencyKey?: string
  decision?: Record<string, unknown>
  status?: string
  enqueueAction?: EnqueueActionBody
}

type DecisionResponse = {
  stored: boolean
  inserted: boolean
  idempotencyKey: string
  actionId?: number
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isAddressLike(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

function parseEnqueueAction(value: EnqueueActionBody | undefined): {
  vaultAddress: `0x${string}`
  groupId: string
  actionType: string
  action: Record<string, unknown>
  dedupeKey?: string | null
} | null {
  if (!value || typeof value !== "object") return null

  const vaultAddress = nonEmptyString(value.vaultAddress)?.toLowerCase() ?? ""
  const groupId = nonEmptyString(value.groupId) ?? ""
  const actionType = nonEmptyString(value.actionType) ?? ""
  const action =
    value.action && typeof value.action === "object" && !Array.isArray(value.action)
      ? value.action
      : null

  if (!isAddressLike(vaultAddress) || !groupId || !actionType || !action) {
    return null
  }

  return {
    vaultAddress,
    groupId,
    actionType,
    action,
    dedupeKey: nonEmptyString(value.dedupeKey ?? undefined),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res)
  setNoStore(res)
  if (handleOptions(req, res)) return

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" } satisfies ApiEnvelope<never>)
  }

  const body = (await readJsonBody<DecisionBody>(req)) ?? {}
  const auth = await authenticateRuntimeRequest(req, body)
  if (!auth.ok) {
    return res.status(auth.status).json({
      success: false,
      error: auth.error,
    } satisfies ApiEnvelope<never>)
  }

  const workflow = nonEmptyString(body.workflow)
  const idempotencyKey = nonEmptyString(body.idempotencyKey)
  const decision =
    body.decision && typeof body.decision === "object" && !Array.isArray(body.decision)
      ? body.decision
      : null

  if (!workflow || !idempotencyKey || !decision) {
    return res.status(400).json({
      success: false,
      error: "workflow, idempotencyKey, and decision are required",
    } satisfies ApiEnvelope<never>)
  }

  try {
    const stored = await storeRuntimeDecision({
      workflow,
      idempotencyKey,
      decision,
      status: nonEmptyString(body.status) ?? "stored",
      correlationId: auth.correlationId,
    })

    const enqueueAction = parseEnqueueAction(body.enqueueAction)
    const actionId = enqueueAction ? await maybeEnqueueRuntimeAction(enqueueAction) : undefined

    logger.info("CRE decision stored", {
      workflow,
      idempotencyKey,
      inserted: stored.inserted,
      actionId,
      correlationId: auth.correlationId,
    })

    return res.status(200).json({
      success: true,
      data: {
        stored: true,
        inserted: stored.inserted,
        idempotencyKey,
        ...(actionId ? { actionId } : {}),
      },
    } satisfies ApiEnvelope<DecisionResponse>)
  } catch (error) {
    logger.error("CRE decision error", { error, correlationId: auth.correlationId })
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    } satisfies ApiEnvelope<never>)
  }
}
