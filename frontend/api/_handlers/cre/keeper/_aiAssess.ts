import type { VercelRequest, VercelResponse } from '@vercel/node'

import { type ApiEnvelope, handleOptions, setCors, setNoStore } from '../../../../server/auth/_shared.js'
import { getElizaLlmService } from '../../../../server/agent/eliza/llm.js'

type AlertSeverity = 'info' | 'warning' | 'critical'
type AiVerdict = 'pass' | 'watch' | 'critical' | 'unknown'

type AlertInput = {
  alertType: string
  severity: AlertSeverity
  message: string
  details?: Record<string, unknown>
}

type RequestBody = {
  vaultAddress?: string
  checksRun?: number
  alerts?: AlertInput[]
}

type AiAssessment = {
  enabled: boolean
  verdict: AiVerdict
  confidence: number | null
  summary: string
  suggestedAction: string
  provider?: string
  error?: string
}

const MAX_ALERTS_FOR_PROMPT = 8
const MAX_SUMMARY_LEN = 280
const MAX_ACTION_LEN = 220

function isAddressLike(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

function isSeverity(value: unknown): value is AlertSeverity {
  return value === 'info' || value === 'warning' || value === 'critical'
}

function deriveDeterministicVerdict(alerts: AlertInput[]): AiVerdict {
  if (alerts.some((alert) => alert.severity === 'critical')) return 'critical'
  if (alerts.some((alert) => alert.severity === 'warning' || alert.severity === 'info')) return 'watch'
  return 'pass'
}

function defaultSuggestedAction(verdict: AiVerdict): string {
  if (verdict === 'critical') return 'Pause keeper-triggered writes and investigate immediately.'
  if (verdict === 'watch') return 'Review warnings and monitor closely on the next run.'
  if (verdict === 'pass') return 'No action required; continue normal monitoring cadence.'
  return 'Investigate telemetry and rerun checks.'
}

function fallbackAssessment(alerts: AlertInput[], error?: string): AiAssessment {
  const verdict = deriveDeterministicVerdict(alerts)
  return {
    enabled: false,
    verdict,
    confidence: null,
    summary:
      alerts.length > 0
        ? `AI assessment unavailable; using deterministic checks with ${alerts.length} alert(s).`
        : 'AI assessment unavailable; deterministic checks indicate no active alerts.',
    suggestedAction: defaultSuggestedAction(verdict),
    ...(error ? { error } : {}),
  }
}

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value
  return `${value.slice(0, maxLen - 1)}…`
}

function parseAssessmentJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {}

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

function normalizeVerdict(value: unknown, fallback: AiVerdict): AiVerdict {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'pass' || raw === 'watch' || raw === 'critical' || raw === 'unknown') return raw
  return fallback
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0 || value > 1) return null
  return Number(value.toFixed(2))
}

function normalizeAssessment(raw: Record<string, unknown>, alerts: AlertInput[]): AiAssessment {
  const deterministicVerdict = deriveDeterministicVerdict(alerts)
  const verdict = normalizeVerdict(raw.verdict, deterministicVerdict)
  const summaryRaw = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  const actionRaw = typeof raw.suggestedAction === 'string' ? raw.suggestedAction.trim() : ''
  const provider = typeof raw.provider === 'string' && raw.provider.trim() ? raw.provider.trim() : undefined

  return {
    enabled: true,
    verdict,
    confidence: normalizeConfidence(raw.confidence),
    summary: truncate(
      summaryRaw || `AI assessment completed for ${alerts.length} deterministic alert(s).`,
      MAX_SUMMARY_LEN,
    ),
    suggestedAction: truncate(actionRaw || defaultSuggestedAction(verdict), MAX_ACTION_LEN),
    ...(provider ? { provider } : {}),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res)
  setNoStore(res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' } satisfies ApiEnvelope<never>)
  }

  const secret = process.env.KEEPR_API_KEY
  if (!secret) {
    return res.status(500).json({ success: false, error: 'KEEPR_API_KEY not configured' } satisfies ApiEnvelope<never>)
  }
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ') || auth.slice(7) !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiEnvelope<never>)
  }

  const body = (req.body ?? {}) as RequestBody
  const vaultAddress = typeof body.vaultAddress === 'string' ? body.vaultAddress.trim() : ''
  const checksRun = Number(body.checksRun)
  const alerts = Array.isArray(body.alerts) ? body.alerts : []
  const validAlerts = alerts.filter((alert): alert is AlertInput => {
    return (
      alert &&
      typeof alert === 'object' &&
      typeof alert.alertType === 'string' &&
      isSeverity(alert.severity) &&
      typeof alert.message === 'string'
    )
  })

  if (!isAddressLike(vaultAddress)) {
    return res.status(400).json({ success: false, error: 'Invalid vaultAddress' } satisfies ApiEnvelope<never>)
  }
  if (!Number.isFinite(checksRun) || checksRun < 0) {
    return res.status(400).json({ success: false, error: 'Invalid checksRun' } satisfies ApiEnvelope<never>)
  }
  if (validAlerts.length !== alerts.length) {
    return res.status(400).json({ success: false, error: 'Invalid alerts payload' } satisfies ApiEnvelope<never>)
  }

  const fallback = fallbackAssessment(validAlerts)
  const llm = getElizaLlmService()
  if (llm.getAvailableProviders().length === 0) {
    return res.status(200).json({
      success: true,
      data: fallback,
    } satisfies ApiEnvelope<AiAssessment>)
  }

  const systemPrompt =
    'You are an onchain risk analyst. Return strict JSON only with keys: ' +
    'verdict (pass|watch|critical|unknown), confidence (0..1), summary, suggestedAction.'

  const promptPayload = {
    vaultAddress,
    checksRun,
    alertCount: validAlerts.length,
    alerts: validAlerts.slice(0, MAX_ALERTS_FOR_PROMPT).map((alert) => ({
      alertType: alert.alertType,
      severity: alert.severity,
      message: alert.message,
      details: alert.details ?? {},
    })),
  }

  try {
    const result = await llm.generateResponse({
      agentKey: `cre:payout-integrity:${vaultAddress.toLowerCase()}`,
      userMessage: JSON.stringify(promptPayload),
      systemPrompt,
      vaultContext: '',
      correlationId: `cre-ai-assess-${Date.now()}`,
      preferredModel: process.env.CRE_AI_MODEL?.trim() || undefined,
    })

    const raw = parseAssessmentJson(result.text ?? '')
    if (!raw) {
      return res.status(200).json({
        success: true,
        data: fallbackAssessment(validAlerts, 'invalid_ai_json'),
      } satisfies ApiEnvelope<AiAssessment>)
    }

    const normalized = normalizeAssessment(
      {
        ...raw,
        provider: result.provider ?? (raw.provider as string | undefined),
      },
      validAlerts,
    )

    return res.status(200).json({
      success: true,
      data: normalized,
    } satisfies ApiEnvelope<AiAssessment>)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return res.status(200).json({
      success: true,
      data: fallbackAssessment(validAlerts, `llm_error:${message}`),
    } satisfies ApiEnvelope<AiAssessment>)
  }
}
