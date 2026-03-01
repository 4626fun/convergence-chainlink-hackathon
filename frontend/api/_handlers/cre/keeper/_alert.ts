/**
 * POST /api/cre/keeper/alert
 *
 * Receives alerts from CRE workflows (payout integrity failures, settlement
 * issues, etc.) and forwards them to the console + webhook alerting system.
 *
 * Protected by KEEPR_API_KEY Bearer token.
 *
 * Request body: {
 *   vaultAddress: string,
 *   alertType: string,
 *   severity: 'info' | 'warning' | 'critical',
 *   message: string,
 *   details?: Record<string, unknown>
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { type ApiEnvelope, handleOptions, setCors, setNoStore } from '../../../../server/auth/_shared.js'

type AlertSeverity = 'info' | 'warning' | 'critical'

interface AlertPayload {
  vaultAddress?: string
  alertType: string
  severity: AlertSeverity
  message: string
  details?: Record<string, unknown>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(req, res)
  setNoStore(res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' } satisfies ApiEnvelope<never>)
  }

  // Auth check
  const secret = process.env.KEEPR_API_KEY
  if (!secret) {
    return res.status(500).json({ success: false, error: 'KEEPR_API_KEY not configured' } satisfies ApiEnvelope<never>)
  }

  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ') || auth.slice(7) !== secret) {
    return res.status(401).json({ success: false, error: 'Unauthorized' } satisfies ApiEnvelope<never>)
  }

  const body = req.body as AlertPayload | undefined
  if (!body?.alertType || !body?.severity || !body?.message) {
    return res.status(400).json({
      success: false,
      error: 'Must provide alertType, severity, and message',
    } satisfies ApiEnvelope<never>)
  }

  const { vaultAddress, alertType, severity, message, details } = body

  // Log to console with severity-appropriate level
  const logPrefix = `[cre/alert][${severity.toUpperCase()}][${alertType}]`
  const logMsg = vaultAddress
    ? `${logPrefix} ${vaultAddress}: ${message}`
    : `${logPrefix} ${message}`

  switch (severity) {
    case 'critical':
      console.error(logMsg, details ?? '')
      break
    case 'warning':
      console.warn(logMsg, details ?? '')
      break
    default:
      console.log(logMsg, details ?? '')
  }

  // Forward to webhook if configured
  const webhookUrl = process.env.KEEPR_ALERT_WEBHOOK_URL
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'cre-workflow',
          alertType,
          severity,
          vaultAddress,
          message,
          details,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      console.warn('[cre/alert] Failed to forward to webhook:', err)
    }
  }

  return res.status(200).json({
    success: true,
    data: { received: true },
  } satisfies ApiEnvelope<{ received: boolean }>)
}
