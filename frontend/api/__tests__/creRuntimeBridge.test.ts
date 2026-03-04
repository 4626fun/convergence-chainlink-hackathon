import { beforeEach, describe, expect, it, vi } from 'vitest'

import decisionsHandler from '../_handlers/cre/runtime/_decisions.ts'
import ingestHandler from '../_handlers/cre/runtime/_ingest.ts'
import triggerHandler from '../_handlers/cre/runtime/_trigger.ts'
import { createMockReq, createMockRes } from './helpers'

const mocks = vi.hoisted(() => ({
  handleOptions: vi.fn(() => false),
  readJsonBody: vi.fn(async (req: any) => req.body ?? null),
  authenticateRuntimeRequest: vi.fn(async () => ({ ok: true, correlationId: 'corr-test' })),
  listRuntimeRecords: vi.fn(async () => []),
  storeRuntimeRecord: vi.fn(async (_input: any) => ({
    record: {
      id: 1,
      workflow: 'runtime-indexer-block',
      kind: 'block',
      idempotencyKey: 'abc',
      payload: {},
      source: 'test',
      correlationId: 'corr-test',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    inserted: true,
  })),
  storeRuntimeDecision: vi.fn(async (_input: any) => ({
    decision: {
      id: 1,
      workflow: 'runtime-orchestrator',
      idempotencyKey: 'decision-1',
      decision: {},
      status: 'stored',
      correlationId: 'corr-test',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    inserted: true,
  })),
  maybeEnqueueRuntimeAction: vi.fn(async () => 123),
  executeCreHttpTrigger: vi.fn(async () => ({
    ok: true,
    statusCode: 200,
    requestId: 'req-1',
    gatewayUrl: 'https://gateway.example',
    response: { result: { status: 'ACCEPTED' } },
  })),
}))

vi.mock('../../server/auth/_shared.js', () => ({
  handleOptions: mocks.handleOptions,
  readJsonBody: mocks.readJsonBody,
  setCors: vi.fn(),
  setNoStore: vi.fn(),
}))

vi.mock('../../server/_lib/cre/runtimeBridge.js', () => ({
  authenticateRuntimeRequest: mocks.authenticateRuntimeRequest,
  listRuntimeRecords: mocks.listRuntimeRecords,
  storeRuntimeRecord: mocks.storeRuntimeRecord,
  storeRuntimeDecision: mocks.storeRuntimeDecision,
  maybeEnqueueRuntimeAction: mocks.maybeEnqueueRuntimeAction,
  executeCreHttpTrigger: mocks.executeCreHttpTrigger,
}))

describe('CRE runtime bridge handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handleOptions.mockReturnValue(false)
    mocks.readJsonBody.mockImplementation(async (req: any) => req.body ?? null)
    mocks.authenticateRuntimeRequest.mockResolvedValue({ ok: true, correlationId: 'corr-test' })
  })

  it('validates ingest POST required fields', async () => {
    const req = createMockReq({ method: 'POST', body: {} })
    const res = createMockRes()
    await ingestHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(String(res.body?.error ?? '')).toContain('workflow, kind, and idempotencyKey are required')
  })

  it('returns records from ingest GET', async () => {
    mocks.listRuntimeRecords.mockResolvedValueOnce([
      {
        id: 1,
        workflow: 'runtime-indexer-block',
        kind: 'block',
        idempotencyKey: 'block-1',
        payload: { blockNumber: 12 },
        source: 'cre',
        correlationId: 'corr',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ] as any)
    const req = createMockReq({ method: 'GET', query: { kind: 'block', limit: '1' } })
    const res = createMockRes()
    await ingestHandler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body?.success).toBe(true)
    expect(res.body?.data?.count).toBe(1)
  })

  it('stores decisions and enqueues optional action', async () => {
    const req = createMockReq({
      method: 'POST',
      body: {
        workflow: 'runtime-orchestrator',
        idempotencyKey: 'decision-1',
        decision: { shouldAct: true },
        enqueueAction: {
          vaultAddress: '0x1111111111111111111111111111111111111111',
          groupId: 'group-1',
          actionType: 'notify',
          action: { command: 'ping' },
          dedupeKey: 'dedupe-1',
        },
      },
    })
    const res = createMockRes()
    await decisionsHandler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body?.success).toBe(true)
    expect(res.body?.data?.actionId).toBe(123)
    expect(mocks.maybeEnqueueRuntimeAction).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid workflow IDs for trigger endpoint', async () => {
    const req = createMockReq({
      method: 'POST',
      body: { workflowId: 'bad', input: { hello: 'world' } },
    })
    const res = createMockRes()
    await triggerHandler(req, res)
    expect(res.statusCode).toBe(400)
    expect(String(res.body?.error ?? '')).toContain('workflowId must be a 64-character hex string')
  })

  it('dispatches valid trigger requests', async () => {
    const req = createMockReq({
      method: 'POST',
      body: {
        workflowId: 'a'.repeat(64),
        input: { mode: 'manual', checkpointKey: 'slot:1' },
        requestId: 'req-manual-1',
      },
    })
    const res = createMockRes()
    await triggerHandler(req, res)
    expect(res.statusCode).toBe(200)
    expect(res.body?.success).toBe(true)
    expect(res.body?.data?.requestId).toBe('req-1')
    expect(mocks.executeCreHttpTrigger).toHaveBeenCalledTimes(1)
  })
})
