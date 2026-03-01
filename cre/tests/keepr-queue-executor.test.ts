import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeQueueProcessor } from '../actions/keepr-queue-executor.action.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pendingAction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    vaultAddress: '0x00000000000000000000000000000000000000bb',
    groupId: 'group-1',
    actionType: 'xmtp.group.add_member',
    action: { action: 'xmtp.group.add_member', wallet: '0x00000000000000000000000000000000000000aa' },
    dedupeKey: null,
    status: 'pending',
    attemptCount: 0,
    lastError: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('keepr queue executor', () => {
  const originalFetch = globalThis.fetch;
  const originalApiBase = process.env.KEEPR_API_BASE_URL;
  const originalApiKey = process.env.KEEPR_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KEEPR_API_BASE_URL = 'https://api.test';
    process.env.KEEPR_API_KEY = 'secret';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.KEEPR_API_BASE_URL = originalApiBase;
    process.env.KEEPR_API_KEY = originalApiKey;
  });

  it('marks action executed when execute endpoint succeeds', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });

      if (url.endsWith('/keepr/actions/pending?limit=10')) {
        return jsonResponse({
          success: true,
          data: { actions: [pendingAction()], count: 1 },
        });
      }
      if (url.endsWith('/keepr/actions/execute')) {
        return jsonResponse({
          success: true,
          data: { executed: true, retryable: false, actionType: 'xmtp.group.add_member' },
        });
      }
      if (url.endsWith('/keepr/actions/updateStatus')) {
        return jsonResponse({ success: true, data: { updated: true } });
      }
      return jsonResponse({ success: false, error: 'unexpected' }, 500);
    }) as any;

    const result = await executeQueueProcessor();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.retried).toBe(0);
    expect(calls.some((c) => c.url.endsWith('/keepr/actions/execute'))).toBe(true);
    expect(
      calls.some(
        (c) => c.url.endsWith('/keepr/actions/updateStatus') && c.body?.status === 'executed',
      ),
    ).toBe(true);
  });

  it('fails immediately on non-retryable 4xx execute errors', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });

      if (url.endsWith('/keepr/actions/pending?limit=10')) {
        return jsonResponse({
          success: true,
          data: { actions: [pendingAction()], count: 1 },
        });
      }
      if (url.endsWith('/keepr/actions/execute')) {
        return jsonResponse(
          {
            success: false,
            error: 'creator_agent_not_configured',
            data: { executed: false, retryable: false, actionType: 'xmtp.group.add_member' },
          },
          400,
        );
      }
      if (url.endsWith('/keepr/actions/updateStatus')) {
        return jsonResponse({ success: true, data: { updated: true } });
      }
      return jsonResponse({ success: false, error: 'unexpected' }, 500);
    }) as any;

    const result = await executeQueueProcessor();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.retried).toBe(0);
    expect(
      calls.some(
        (c) => c.url.endsWith('/keepr/actions/updateStatus') && c.body?.status === 'failed',
      ),
    ).toBe(true);
  });

  it('retries on retryable execute failures', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });

      if (url.endsWith('/keepr/actions/pending?limit=10')) {
        return jsonResponse({
          success: true,
          data: { actions: [pendingAction({ attemptCount: 1 })], count: 1 },
        });
      }
      if (url.endsWith('/keepr/actions/execute')) {
        return jsonResponse(
          {
            success: false,
            error: 'xmtp_network_timeout',
            data: { executed: false, retryable: true, actionType: 'xmtp.group.add_member' },
          },
          503,
        );
      }
      if (url.endsWith('/keepr/actions/updateStatus')) {
        return jsonResponse({ success: true, data: { updated: true } });
      }
      return jsonResponse({ success: false, error: 'unexpected' }, 500);
    }) as any;

    const result = await executeQueueProcessor();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.retried).toBe(1);
    expect(
      calls.some(
        (c) =>
          c.url.endsWith('/keepr/actions/updateStatus') &&
          c.body?.status === 'retry' &&
          c.body?.retryDelaySeconds === 120,
      ),
    ).toBe(true);
  });
});
