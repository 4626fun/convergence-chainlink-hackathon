import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyEnv, createMockReq, createMockRes } from './helpers';
import handler from '../_handlers/cre/keeper/_aiAssess.ts';

const {
  getElizaLlmServiceMock,
  getAvailableProvidersMock,
  generateResponseMock,
} = vi.hoisted(() => ({
  getElizaLlmServiceMock: vi.fn(),
  getAvailableProvidersMock: vi.fn(),
  generateResponseMock: vi.fn(),
}));

vi.mock('../../server/agent/eliza/llm.js', () => ({
  getElizaLlmService: getElizaLlmServiceMock,
}));

describe('cre/keeper/aiAssess', () => {
  let restoreEnv: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    restoreEnv = applyEnv({ KEEPR_API_KEY: 'test-keepr-key' });
    getElizaLlmServiceMock.mockReturnValue({
      getAvailableProviders: getAvailableProvidersMock,
      generateResponse: generateResponseMock,
    });
    getAvailableProvidersMock.mockReturnValue([]);
    generateResponseMock.mockResolvedValue({
      text: null,
      provider: null,
      attempts: [],
    });
  });

  afterEach(() => {
    if (restoreEnv) restoreEnv();
    restoreEnv = null;
  });

  it('rejects unauthorized requests', async () => {
    const req = createMockReq({ method: 'POST', body: {} });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid payloads', async () => {
    const req = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer test-keepr-key' },
      body: { vaultAddress: '0x123' },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  it('returns deterministic fallback when no AI providers are configured', async () => {
    const req = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer test-keepr-key' },
      body: {
        vaultAddress: '0x1111111111111111111111111111111111111111',
        checksRun: 5,
        alerts: [{ alertType: 'gauge_distribution_stale', severity: 'warning', message: 'stale' }],
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data?.enabled).toBe(false);
    expect(res.body?.data?.verdict).toBe('watch');
    expect(generateResponseMock).not.toHaveBeenCalled();
  });

  it('returns normalized AI result when provider response is valid JSON', async () => {
    getAvailableProvidersMock.mockReturnValue([{ name: 'Groq' }]);
    generateResponseMock.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'critical',
        confidence: 0.92,
        summary: 'Multiple critical payout integrity issues detected.',
        suggestedAction: 'Pause keeper-triggered writes and investigate.',
      }),
      provider: 'Groq',
      attempts: [],
    });

    const req = createMockReq({
      method: 'POST',
      headers: { authorization: 'Bearer test-keepr-key' },
      body: {
        vaultAddress: '0x1111111111111111111111111111111111111111',
        checksRun: 5,
        alerts: [{ alertType: 'payout_recipient_mismatch', severity: 'critical', message: 'mismatch' }],
      },
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body?.data?.enabled).toBe(true);
    expect(res.body?.data?.verdict).toBe('critical');
    expect(res.body?.data?.confidence).toBe(0.92);
    expect(res.body?.data?.provider).toBe('Groq');
  });
});
