/**
 * POST /api/cre/keeper/mark-settled
 *
 * Records graduation and/or settlement timestamps for a vault in the DB.
 * Called by CRE workflows after detecting graduation or completing sweep.
 *
 * Protected by KEEPR_API_KEY Bearer token.
 *
 * Request body: { vaultAddress: string, graduatedAt?: string, settledAt?: string }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { type ApiEnvelope, handleOptions, setCors, setNoStore } from '../../../../server/auth/_shared.js'
import { getDb, isDbConfigured } from '../../../../server/_lib/postgres.js'
import { ensureKeeprSchema } from '../../../../server/_lib/keeprSchema.js'

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

  const { vaultAddress, graduatedAt, settledAt } = req.body as {
    vaultAddress?: string
    graduatedAt?: string
    settledAt?: string
  }

  if (!vaultAddress || !vaultAddress.startsWith('0x') || vaultAddress.length !== 42) {
    return res.status(400).json({ success: false, error: 'Invalid vaultAddress' } satisfies ApiEnvelope<never>)
  }

  if (!graduatedAt && !settledAt) {
    return res.status(400).json({ success: false, error: 'Must provide graduatedAt or settledAt' } satisfies ApiEnvelope<never>)
  }

  if (!isDbConfigured()) {
    return res.status(500).json({ success: false, error: 'Database not configured' } satisfies ApiEnvelope<never>)
  }

  try {
    await ensureKeeprSchema()
    const db = await getDb()
    if (!db) {
      return res.status(500).json({ success: false, error: 'Database unavailable' } satisfies ApiEnvelope<never>)
    }

    const addr = vaultAddress.toLowerCase()

    // Update only the fields that are provided, and only if they are currently NULL
    // (don't overwrite existing timestamps)
    if (graduatedAt && settledAt) {
      await db.sql`
        UPDATE keepr_vaults
        SET graduated_at = COALESCE(graduated_at, ${graduatedAt}::timestamptz),
            settled_at = COALESCE(settled_at, ${settledAt}::timestamptz),
            updated_at = NOW()
        WHERE LOWER(vault_address) = ${addr};
      `
    } else if (graduatedAt) {
      await db.sql`
        UPDATE keepr_vaults
        SET graduated_at = COALESCE(graduated_at, ${graduatedAt}::timestamptz),
            updated_at = NOW()
        WHERE LOWER(vault_address) = ${addr};
      `
    } else if (settledAt) {
      await db.sql`
        UPDATE keepr_vaults
        SET settled_at = COALESCE(settled_at, ${settledAt}::timestamptz),
            updated_at = NOW()
        WHERE LOWER(vault_address) = ${addr};
      `
    }

    return res.status(200).json({
      success: true,
      data: { updated: true },
    } satisfies ApiEnvelope<{ updated: boolean }>)
  } catch (err) {
    console.error('[cre/keeper/mark-settled] Error:', err)
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    } satisfies ApiEnvelope<never>)
  }
}
