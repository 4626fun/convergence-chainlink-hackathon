/**
 * POST /api/cre/keeper/sweep
 *
 * HTTP bridge endpoint for CRE workflows. Accepts a CCA strategy address
 * and executes `sweepCurrency()` + `sweepUnsoldTokens()` using the keeper wallet.
 *
 * Note: sweepCurrency() and sweepUnsoldTokens() are permissionless — no
 * keeper role authorization is needed.
 *
 * Protected by KEEPR_API_KEY Bearer token.
 *
 * Request body: { ccaStrategyAddress: string }
 * Response: { success: true, data: { sweepTxHash, unsoldTxHash } }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { type ApiEnvelope, handleOptions, setCors, setNoStore } from '../../../../server/auth/_shared.js'
import { createPublicClient, createWalletClient, http, type Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'

const CCA_STRATEGY_ABI = [
  { type: 'function', name: 'sweepCurrency', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'sweepUnsoldTokens', inputs: [], outputs: [], stateMutability: 'nonpayable' },
] as const

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

  const { ccaStrategyAddress } = req.body as { ccaStrategyAddress?: string }
  if (!ccaStrategyAddress || !ccaStrategyAddress.startsWith('0x') || ccaStrategyAddress.length !== 42) {
    return res.status(400).json({ success: false, error: 'Invalid ccaStrategyAddress' } satisfies ApiEnvelope<never>)
  }

  const keeperPk = process.env.KEEPR_PRIVATE_KEY
  if (!keeperPk) {
    return res.status(500).json({ success: false, error: 'KEEPR_PRIVATE_KEY not configured' } satisfies ApiEnvelope<never>)
  }

  try {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    const account = privateKeyToAccount(keeperPk as `0x${string}`)
    const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl, { timeout: 30_000 }) }) as any
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl, { timeout: 30_000 }) })

    // Step 1: sweepCurrency()
    const sweepTxHash = await walletClient.writeContract({
      address: ccaStrategyAddress as `0x${string}`,
      abi: CCA_STRATEGY_ABI as unknown as Abi,
      functionName: 'sweepCurrency',
      chain: base,
      account,
    })

    const sweepReceipt = await publicClient.waitForTransactionReceipt({ hash: sweepTxHash, timeout: 120_000 })

    if (sweepReceipt.status !== 'success') {
      return res.status(500).json({
        success: false,
        error: 'sweepCurrency() reverted',
        data: { sweepTxHash, status: 'reverted' },
      } as any)
    }

    // Step 2: sweepUnsoldTokens()
    let unsoldTxHash: string | null = null
    let unsoldStatus = 'skipped'
    try {
      unsoldTxHash = await walletClient.writeContract({
        address: ccaStrategyAddress as `0x${string}`,
        abi: CCA_STRATEGY_ABI as unknown as Abi,
        functionName: 'sweepUnsoldTokens',
        chain: base,
        account,
      })

      const unsoldReceipt = await publicClient.waitForTransactionReceipt({ hash: unsoldTxHash, timeout: 120_000 })
      unsoldStatus = unsoldReceipt.status === 'success' ? 'success' : 'reverted'
    } catch (err) {
      // sweepUnsoldTokens failure is non-critical
      console.warn('[cre/keeper/sweep] sweepUnsoldTokens failed (non-critical):', err)
      unsoldStatus = 'failed'
    }

    return res.status(200).json({
      success: true,
      data: {
        sweepTxHash,
        sweepStatus: 'success',
        unsoldTxHash,
        unsoldStatus,
      },
    } satisfies ApiEnvelope<{
      sweepTxHash: string
      sweepStatus: string
      unsoldTxHash: string | null
      unsoldStatus: string
    }>)
  } catch (err) {
    console.error('[cre/keeper/sweep] Error:', err)
    return res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    } satisfies ApiEnvelope<never>)
  }
}
