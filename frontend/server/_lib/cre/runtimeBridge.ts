import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import type { VercelRequest } from "@vercel/node"
import { hexToBytes } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import { logger } from "../logger.js"
import { enqueueKeeprAction } from "../keeprRegistry.js"
import { getDb, isDbConfigured } from "../postgres.js"
import { ensureCreRuntimeSchema } from "./runtimeSchema.js"

type RuntimeRow = {
  id: number
  workflow: string
  kind: string
  idempotency_key: string
  payload_json: unknown
  source: string
  correlation_id: string | null
  created_at: string | Date
}

type DecisionRow = {
  id: number
  workflow: string
  idempotency_key: string
  decision_json: unknown
  status: string
  correlation_id: string | null
  created_at: string | Date
}

export type RuntimeRecord = {
  id: number
  workflow: string
  kind: string
  idempotencyKey: string
  payload: unknown
  source: string
  correlationId: string | null
  createdAt: string
}

export type RuntimeDecision = {
  id: number
  workflow: string
  idempotencyKey: string
  decision: unknown
  status: string
  correlationId: string | null
  createdAt: string
}

export type RuntimeRecordInput = {
  workflow: string
  kind: string
  idempotencyKey: string
  payload: unknown
  source?: string
  correlationId?: string | null
}

export type RuntimeDecisionInput = {
  workflow: string
  idempotencyKey: string
  decision: unknown
  status?: string
  correlationId?: string | null
}

export type RuntimeEnqueueActionInput = {
  vaultAddress: `0x${string}`
  groupId: string
  actionType: string
  action: Record<string, unknown>
  dedupeKey?: string | null
}

export type RuntimeAuthResult =
  | { ok: true; correlationId: string }
  | { ok: false; status: number; error: string; correlationId: string }

type ExecuteWorkflowInput = {
  workflowId: string
  input: Record<string, unknown>
  requestId?: string
}

const localReplayNonceStore = new Map<string, number>()

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function parseHeader(req: VercelRequest, name: string): string | null {
  const raw = req.headers[name.toLowerCase()]
  if (typeof raw === "string") return raw
  if (Array.isArray(raw) && raw.length > 0) return raw[0] ?? null
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => stableClone(entry))
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    out[key] = stableClone(value[key])
  }
  return out
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(stableClone(value))
}

function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input)
  return bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function cleanupLocalReplayStore(nowMs: number) {
  for (const [nonce, expiresAt] of localReplayNonceStore.entries()) {
    if (expiresAt <= nowMs) localReplayNonceStore.delete(nonce)
  }
}

async function registerReplayNonce(nonce: string, expiresAt: Date): Promise<boolean> {
  const nowMs = Date.now()
  if (!isDbConfigured()) {
    cleanupLocalReplayStore(nowMs)
    if (localReplayNonceStore.has(nonce)) return false
    localReplayNonceStore.set(nonce, expiresAt.getTime())
    return true
  }

  await ensureCreRuntimeSchema()
  const db = await getDb()
  if (!db) {
    cleanupLocalReplayStore(nowMs)
    if (localReplayNonceStore.has(nonce)) return false
    localReplayNonceStore.set(nonce, expiresAt.getTime())
    return true
  }

  const result = await db.sql`
    INSERT INTO cre_runtime_replay_nonces (nonce, expires_at)
    VALUES (${nonce}, ${expiresAt.toISOString()})
    ON CONFLICT (nonce) DO NOTHING
    RETURNING nonce;
  `
  return result.rows.length > 0
}

function normalizeSignatureHeader(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("sha256=")) return trimmed.slice("sha256=".length)
  return trimmed
}

function safeEqualsHex(leftHex: string, rightHex: string): boolean {
  try {
    const left = Buffer.from(leftHex, "hex")
    const right = Buffer.from(rightHex, "hex")
    if (left.length !== right.length) return false
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

function mapRuntimeRow(row: RuntimeRow): RuntimeRecord {
  return {
    id: Number(row.id),
    workflow: row.workflow,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    payload: row.payload_json,
    source: row.source,
    correlationId: row.correlation_id,
    createdAt: toIso(row.created_at),
  }
}

function mapDecisionRow(row: DecisionRow): RuntimeDecision {
  return {
    id: Number(row.id),
    workflow: row.workflow,
    idempotencyKey: row.idempotency_key,
    decision: row.decision_json,
    status: row.status,
    correlationId: row.correlation_id,
    createdAt: toIso(row.created_at),
  }
}

export async function authenticateRuntimeRequest(req: VercelRequest, body: unknown): Promise<RuntimeAuthResult> {
  const correlationId = parseHeader(req, "x-correlation-id") ?? `cre-runtime-${randomUUID()}`
  const expectedApiKey = process.env.KEEPR_API_KEY
  if (!expectedApiKey) {
    return { ok: false, status: 500, error: "KEEPR_API_KEY not configured", correlationId }
  }

  const authorization = parseHeader(req, "authorization") ?? ""
  if (!authorization.startsWith("Bearer ") || authorization.slice(7) !== expectedApiKey) {
    return { ok: false, status: 401, error: "Unauthorized", correlationId }
  }

  const hmacSecret = (process.env.CRE_RUNTIME_WEBHOOK_HMAC_SECRET ?? "").trim()
  if (!hmacSecret) {
    return { ok: true, correlationId }
  }

  const tsRaw = parseHeader(req, "x-cre-timestamp")
  const nonce = parseHeader(req, "x-cre-nonce")
  const signatureRaw = parseHeader(req, "x-cre-signature")
  if (!tsRaw || !nonce || !signatureRaw) {
    logger.warn("CRE runtime request accepted without HMAC signature", {
      correlationId,
      method: req.method,
      path: req.url,
    })
    return { ok: true, correlationId }
  }

  const timestampMs = Number(tsRaw)
  if (!Number.isFinite(timestampMs)) {
    return { ok: false, status: 401, error: "Invalid x-cre-timestamp", correlationId }
  }

  const now = Date.now()
  const allowedSkewMs = 5 * 60 * 1000
  if (Math.abs(now - timestampMs) > allowedSkewMs) {
    return { ok: false, status: 401, error: "Stale runtime request timestamp", correlationId }
  }

  const expiresAt = new Date(timestampMs + allowedSkewMs)
  const nonceAccepted = await registerReplayNonce(nonce, expiresAt)
  if (!nonceAccepted) {
    return { ok: false, status: 409, error: "Replay nonce already used", correlationId }
  }

  const bodyCanonical = stableJsonStringify(body)
  const signedPayload = `${tsRaw}.${nonce}.${bodyCanonical}`
  const expectedSignature = createHmac("sha256", hmacSecret).update(signedPayload).digest("hex")
  const providedSignature = normalizeSignatureHeader(signatureRaw)
  if (!safeEqualsHex(expectedSignature, providedSignature)) {
    return { ok: false, status: 401, error: "Invalid runtime request signature", correlationId }
  }

  return { ok: true, correlationId }
}

export async function storeRuntimeRecord(input: RuntimeRecordInput): Promise<{ record: RuntimeRecord; inserted: boolean }> {
  await ensureCreRuntimeSchema()
  const db = await getDb()
  if (!db) throw new Error("database_unavailable")

  const source = input.source ?? "cre"
  const correlationId = input.correlationId ?? null
  const result = await db.sql`
    WITH upsert AS (
      INSERT INTO cre_runtime_records (
        workflow, kind, idempotency_key, payload_json, source, correlation_id
      ) VALUES (
        ${input.workflow},
        ${input.kind},
        ${input.idempotencyKey},
        ${input.payload},
        ${source},
        ${correlationId}
      )
      ON CONFLICT (workflow, kind, idempotency_key)
      DO UPDATE SET
        payload_json = EXCLUDED.payload_json,
        source = EXCLUDED.source,
        correlation_id = EXCLUDED.correlation_id,
        updated_at = NOW()
      RETURNING
        id, workflow, kind, idempotency_key, payload_json, source, correlation_id, created_at,
        (xmax = 0) AS inserted
    )
    SELECT * FROM upsert LIMIT 1;
  `

  const row = result.rows[0] as (RuntimeRow & { inserted: boolean }) | undefined
  if (!row) throw new Error("runtime_record_upsert_failed")
  return { record: mapRuntimeRow(row), inserted: Boolean(row.inserted) }
}

export async function listRuntimeRecords(params: {
  kind?: string
  limit?: number
}): Promise<RuntimeRecord[]> {
  await ensureCreRuntimeSchema()
  const db = await getDb()
  if (!db) throw new Error("database_unavailable")

  const limit = Math.max(1, Math.min(100, params.limit ?? 20))
  const hasKind = typeof params.kind === "string" && params.kind.trim().length > 0
  const rows = hasKind
    ? await db.sql`
        SELECT id, workflow, kind, idempotency_key, payload_json, source, correlation_id, created_at
        FROM cre_runtime_records
        WHERE kind = ${params.kind!.trim()}
        ORDER BY created_at DESC
        LIMIT ${limit};
      `
    : await db.sql`
        SELECT id, workflow, kind, idempotency_key, payload_json, source, correlation_id, created_at
        FROM cre_runtime_records
        ORDER BY created_at DESC
        LIMIT ${limit};
      `

  return rows.rows.map((row) => mapRuntimeRow(row as RuntimeRow))
}

export async function storeRuntimeDecision(input: RuntimeDecisionInput): Promise<{ decision: RuntimeDecision; inserted: boolean }> {
  await ensureCreRuntimeSchema()
  const db = await getDb()
  if (!db) throw new Error("database_unavailable")

  const status = input.status ?? "stored"
  const correlationId = input.correlationId ?? null
  const result = await db.sql`
    WITH upsert AS (
      INSERT INTO cre_runtime_decisions (
        workflow, idempotency_key, decision_json, status, correlation_id
      ) VALUES (
        ${input.workflow},
        ${input.idempotencyKey},
        ${input.decision},
        ${status},
        ${correlationId}
      )
      ON CONFLICT (workflow, idempotency_key)
      DO UPDATE SET
        decision_json = EXCLUDED.decision_json,
        status = EXCLUDED.status,
        correlation_id = EXCLUDED.correlation_id,
        updated_at = NOW()
      RETURNING
        id, workflow, idempotency_key, decision_json, status, correlation_id, created_at,
        (xmax = 0) AS inserted
    )
    SELECT * FROM upsert LIMIT 1;
  `

  const row = result.rows[0] as (DecisionRow & { inserted: boolean }) | undefined
  if (!row) throw new Error("runtime_decision_upsert_failed")
  return { decision: mapDecisionRow(row), inserted: Boolean(row.inserted) }
}

export async function maybeEnqueueRuntimeAction(input: RuntimeEnqueueActionInput): Promise<number> {
  const result = await enqueueKeeprAction({
    vaultAddress: input.vaultAddress,
    groupId: input.groupId,
    actionType: input.actionType,
    dedupeKey: input.dedupeKey ?? null,
    action: input.action,
  })
  return result.id
}

function resolveGatewayUrl(): string {
  const value = (process.env.CRE_GATEWAY_URL ?? "").trim()
  if (!value) throw new Error("cre_gateway_url_not_configured")
  return value.replace(/\/$/, "")
}

function resolveTriggerPrivateKey(): `0x${string}` {
  const value = (
    process.env.CRE_HTTP_TRIGGER_PRIVATE_KEY ??
    process.env.CRE_TRIGGER_SIGNER_PRIVATE_KEY ??
    ""
  ).trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("cre_trigger_private_key_not_configured")
  }
  return value as `0x${string}`
}

function resolveRequestId(requestId?: string): string {
  if (requestId && requestId.trim()) return requestId.trim()
  return `req-${randomUUID()}`
}

export async function executeCreHttpTrigger(input: ExecuteWorkflowInput): Promise<{
  ok: boolean
  statusCode: number
  requestId: string
  gatewayUrl: string
  response: unknown
}> {
  const gatewayUrl = resolveGatewayUrl()
  const privateKey = resolveTriggerPrivateKey()
  const account = privateKeyToAccount(privateKey)
  const nowSeconds = Math.floor(Date.now() / 1000)
  const requestId = resolveRequestId(input.requestId)

  const rpcRequest = {
    id: requestId,
    jsonrpc: "2.0",
    method: "workflows.execute",
    params: {
      input: input.input,
      workflow: { workflowID: input.workflowId },
    },
  } as const

  const canonicalBody = stableJsonStringify(rpcRequest)
  const digest = `0x${createHash("sha256").update(canonicalBody, "utf8").digest("hex")}`

  const jwtHeader = { alg: "ETH", typ: "JWT" } as const
  const jwtPayload = {
    digest,
    iss: account.address,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    jti: randomUUID(),
  } as const

  const headerSegment = base64UrlEncode(stableJsonStringify(jwtHeader))
  const payloadSegment = base64UrlEncode(stableJsonStringify(jwtPayload))
  const signingInput = `${headerSegment}.${payloadSegment}`
  const signatureHex = await account.signMessage({ message: signingInput })
  const signatureSegment = base64UrlEncode(hexToBytes(signatureHex))
  const jwt = `${signingInput}.${signatureSegment}`

  const response = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
    },
    body: canonicalBody,
    signal: AbortSignal.timeout(30_000),
  })

  const textBody = await response.text()
  let parsed: unknown = { raw: textBody }
  try {
    parsed = JSON.parse(textBody)
  } catch {
    // Keep raw text response for diagnostics.
  }

  logger.info("CRE HTTP trigger execute", {
    gatewayUrl,
    workflowId: input.workflowId,
    statusCode: response.status,
    requestId,
  })

  return {
    ok: response.ok,
    statusCode: response.status,
    requestId,
    gatewayUrl,
    response: parsed,
  }
}
