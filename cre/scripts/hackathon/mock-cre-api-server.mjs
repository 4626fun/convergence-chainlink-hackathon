#!/usr/bin/env node

import { createServer } from 'node:http';

const HOST = process.env.CRE_MOCK_API_HOST ?? '127.0.0.1';
const PORT = Number(process.env.CRE_MOCK_API_PORT ?? '8789');
const API_KEY = process.env.CRE_MOCK_API_KEY ?? process.env.KEEPR_API_KEY_VALUE ?? 'local-test-key';

const MOCK_VAULT = {
  vaultAddress: '0xA015954E2606d08967Aee3787456bB3A86a46A42',
  chainId: 8453,
  creatorCoinAddress: '0x5b674196812451b7cec024fe9d22d2c0b172fa75',
  gaugeControllerAddress: '0xB471B53cD0A30289Bc3a2dc3c6dd913288F8baA1',
  burnStreamAddress: '',
  groupId: 'mock-group-1',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parseMaybeBase64Json(input) {
  if (!input) return null;
  const asText = input.toString('utf8');
  try {
    return JSON.parse(asText);
  } catch {}
  try {
    return JSON.parse(Buffer.from(asText, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

function deriveVerdictFromAlerts(alerts) {
  if (!Array.isArray(alerts)) return 'unknown';
  if (alerts.some((a) => a?.severity === 'critical')) return 'critical';
  if (alerts.some((a) => a?.severity === 'warning' || a?.severity === 'info')) return 'watch';
  return 'pass';
}

const server = createServer((req, res) => {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);
  const path = url.pathname;
  const auth = req.headers.authorization ?? '';

  if (path === '/healthz') {
    return sendJson(res, 200, { ok: true });
  }

  if (auth !== `Bearer ${API_KEY}`) {
    return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  }

  if (method === 'GET' && path === '/api/cre/vaults/active') {
    return sendJson(res, 200, {
      success: true,
      data: { vaults: [MOCK_VAULT] },
    });
  }

  if (method === 'GET' && path === '/api/keepr/actions/pending') {
    return sendJson(res, 200, {
      success: true,
      data: { actions: [], count: 0 },
    });
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const parsed = parseMaybeBase64Json(Buffer.concat(chunks));

    if (method === 'POST' && path === '/api/cre/keeper/aiAssess') {
      const alerts = Array.isArray(parsed?.alerts) ? parsed.alerts : [];
      const verdict = deriveVerdictFromAlerts(alerts);
      return sendJson(res, 200, {
        success: true,
        data: {
          enabled: true,
          verdict,
          confidence: verdict === 'critical' ? 0.93 : verdict === 'watch' ? 0.8 : 0.72,
          summary: `Mock AI assessed ${alerts.length} deterministic alert(s).`,
          suggestedAction:
            verdict === 'critical'
              ? 'Pause keeper-triggered writes and investigate immediately.'
              : 'Continue monitoring and review warnings.',
          provider: 'mock-ai',
        },
      });
    }

    if (method === 'POST' && path.startsWith('/api/cre/keeper/')) {
      return sendJson(res, 200, {
        success: true,
        data: { ok: true, endpoint: path, payload: parsed ?? {} },
      });
    }

    if (method === 'POST' && path === '/api/keepr/actions/updateStatus') {
      return sendJson(res, 200, {
        success: true,
        data: { updated: true },
      });
    }

    if (method === 'POST' && path === '/api/keepr/actions/execute') {
      return sendJson(res, 200, {
        success: true,
        data: {
          executed: true,
          retryable: false,
          actionType: parsed?.actionType ?? 'mock_action',
        },
      });
    }

    return sendJson(res, 404, { success: false, error: 'Not found' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-cre-api] listening on http://${HOST}:${PORT}`);
});
