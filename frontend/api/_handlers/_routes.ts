import type { VercelRequest, VercelResponse } from '@vercel/node'

export type ApiHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>

// IMPORTANT:
// This file exists to make Vercel's bundler include our API handlers.
// Dynamic `import(\`./${subpath}.js\`)` will often *not* bundle the target modules,
// causing runtime 404s for routes like `/api/auth/nonce`.

type ApiHandlerModule = { default?: ApiHandler }

// Use static import() calls so Vercel's bundler can see dependencies,
// but avoid eager importing every handler at module-load time (which can crash the entire function).
export const apiRouteLoaders: Record<string, () => Promise<ApiHandlerModule>> = {
  'analytics': () => import('./_analytics.js'),
  'agents': () => import('./_agents.js'),
  'agents/subdomains/resolve': () => import('./agents/_subdomains-resolve.js'),
  'agents/subdomains/upsert': () => import('./agents/_subdomains-upsert.js'),
  'agent/invokeSkill': () => import('./agent/_invokeSkill.js'),
  'agent/stream': () => import('./agent/_stream.js'),
  // agent/process is deployed as a standalone function (api/agent/process.ts)
  // to isolate the heavy @xmtp/node-bindings (~214 MB) from the catch-all bundle.
  // 'agent/process': () => import('./agent/_process.js'),

  // Public, agent-friendly v1 API
  'v1/spec.json': () => import('./v1/_spec.js'),
  'v1/vault/report': () => import('./v1/vault/_report.js'),
  'v1/vault/strategies': () => import('./v1/vault/_strategies.js'),
  'v1/auction/status': () => import('./v1/auction/_status.js'),
  'v1/auction/recentBids': () => import('./v1/auction/_recentBids.js'),
  'v1/lottery/global': () => import('./v1/lottery/_global.js'),
  'v1/lottery/creator': () => import('./v1/lottery/_creator.js'),
  'v1/lottery/recentWinners': () => import('./v1/lottery/_recentWinners.js'),
  'v1/gauge/epoch': () => import('./v1/gauge/_epoch.js'),
  'v1/gauge/vaults': () => import('./v1/gauge/_vaults.js'),
  'v1/gauge/user': () => import('./v1/gauge/_user.js'),
  'v1/ve4626/user': () => import('./v1/ve4626/_user.js'),
  'v1/charm/strategy': () => import('./v1/charm/_strategy.js'),
  'v1/creators/quickstart': () => import('./v1/creators/_quickstart.js'),
  'v1/agents/creators': () => import('./v1/agents/creators/_list.js'),
  'v1/agents/creators/enable': () => import('./v1/agents/creators/_enable.js'),
  'v1/agents/creators/provision-wallet': () => import('./v1/agents/creators/_provisionWallet.js'),
  'v1/agents/feedback': () => import('./v1/agents/feedback/_read.js'),
  'v1/agents/feedback/submit': () => import('./v1/agents/feedback/_submit.js'),
  'v1/agents/identity/verification': () => import('./v1/agents/identity/_verification.js'),
  'v1/agents/identity/set-agent-wallet': () => import('./v1/agents/identity/_setAgentWallet.js'),
  'v1/agents/wallet-intelligence': () => import('./v1/agents/_wallet-intelligence.js'),
  'v1/agents/publish': () => import('./v1/agents/_publish.js'),
  // v1 build endpoints (return unsigned tx calldata)
  // Phase 1 + Ajna + Charm endpoints enabled.
  'v1/build/auction/submitBid': () => import('./v1/build/auction/_submitBid.js'),
  'v1/build/gauge/vote': () => import('./v1/build/gauge/_vote.js'),
  'v1/build/gauge/resetVotes': () => import('./v1/build/gauge/_resetVotes.js'),
  'v1/build/ve4626/lock': () => import('./v1/build/ve4626/_lock.js'),
  'v1/build/ve4626/extend': () => import('./v1/build/ve4626/_extend.js'),
  'v1/build/ve4626/increase': () => import('./v1/build/ve4626/_increase.js'),
  'v1/build/ve4626/unlock': () => import('./v1/build/ve4626/_unlock.js'),
  'v1/build/ajna/borrow': () => import('./v1/build/ajna/_borrow.js'),
  'v1/build/ajna/repay': () => import('./v1/build/ajna/_repay.js'),
  'v1/build/ajna/addCollateral': () => import('./v1/build/ajna/_addCollateral.js'),
  'v1/build/ajna/removeCollateral': () => import('./v1/build/ajna/_removeCollateral.js'),
  'v1/build/ajna/setBucketIndex': () => import('./v1/build/ajna/_setBucketIndex.js'),
  'v1/build/ajna/moveToBucket': () => import('./v1/build/ajna/_moveToBucket.js'),
  'v1/build/ajna/setIdleBufferBps': () => import('./v1/build/ajna/_setIdleBufferBps.js'),
  'v1/build/charm/setCharmVault': () => import('./v1/build/charm/_setCharmVault.js'),
  'v1/build/charm/setSwapPool': () => import('./v1/build/charm/_setSwapPool.js'),
  'v1/build/charm/setZRouter': () => import('./v1/build/charm/_setZRouter.js'),
  'v1/build/charm/setUseZRouter': () => import('./v1/build/charm/_setUseZRouter.js'),
  'v1/build/charm/setUniFactory': () => import('./v1/build/charm/_setUniFactory.js'),
  'v1/build/charm/setAutoFeeTier': () => import('./v1/build/charm/_setAutoFeeTier.js'),
  'v1/build/charm/setParameters': () => import('./v1/build/charm/_setParameters.js'),
  'v1/build/charm/setActive': () => import('./v1/build/charm/_setActive.js'),
  'v1/build/charm/initializeApprovals': () => import('./v1/build/charm/_initializeApprovals.js'),
  'v1/build/charm/rebalance': () => import('./v1/build/charm/_rebalance.js'),
  'v1/build/charm/ownerEmergencyWithdraw': () => import('./v1/build/charm/_ownerEmergencyWithdraw.js'),
  'v1/build/charm/ownerEmergencyWithdrawFromCharm': () => import('./v1/build/charm/_ownerEmergencyWithdrawFromCharm.js'),
  'v1/build/charm/vault/rebalance': () => import('./v1/build/charm/vault/_rebalance.js'),
  'v1/build/charm/vault/setStrategy': () => import('./v1/build/charm/vault/_setStrategy.js'),

  'keepr/join': () => import('./keepr/_join.js'),
  'keepr/joinStatus': () => import('./keepr/_joinStatus.js'),
  'keepr/nonce': () => import('./keepr/_nonce.js'),
  'keepr/vault/upsert': () => import('./keepr/vault/_upsert.js'),
  'keepr/actions/pending': () => import('./keepr/actions/_pending.js'),
  'keepr/actions/updateStatus': () => import('./keepr/actions/_updateStatus.js'),

  // CRE workflow endpoints
  'cre/vaults/active': () => import('./cre/vaults/_active.js'),
  'cre/keeper/tend': () => import('./cre/keeper/_tend.js'),
  'cre/keeper/report': () => import('./cre/keeper/_report.js'),
  'cre/keeper/sweep': () => import('./cre/keeper/_sweep.js'),
  'cre/keeper/mark-settled': () => import('./cre/keeper/_markSettled.js'),
  'cre/keeper/alert': () => import('./cre/keeper/_alert.js'),
  'cre/keeper/aiAssess': () => import('./cre/keeper/_aiAssess.js'),

  'auth/admin': () => import('./auth/_admin.js'),
  'auth/agent-nonce': () => import('./auth/_agent-nonce.js'),
  'auth/agent-verify': () => import('./auth/_agent-verify.js'),
  'auth/logout': () => import('./auth/_logout.js'),
  'auth/me': () => import('./auth/_me.js'),
  'auth/nonce': () => import('./auth/_nonce.js'),
  'auth/privy': () => import('./auth/_privy.js'),
  'auth/verify': () => import('./auth/_verify.js'),
  'wallet/sync': () => import('./wallet/_sync.js'),
  'wallet/solana/setCanonical': () => import('./wallet/solana/_setCanonical.js'),
  'wallet/solana/sweep/enqueue': () => import('./wallet/solana/sweep/_enqueue.js'),
  'wallet/solana/sweep/process': () => import('./wallet/solana/sweep/_process.js'),
  'portfolio/me': () => import('./portfolio/_me.js'),

  'creator-allowlist': () => import('./_creator-allowlist.js'),
  'creator-wallets/claim': () => import('./_creator-wallets-claim.js'),
  'creator-access/debug': () => import('./creator-access/_debug.js'),
  'creator-access/request': () => import('./creator-access/_request.js'),
  'creator-access/status': () => import('./creator-access/_status.js'),

  'debank/totalBalanceBatch': () => import('./debank/_totalBalanceBatch.js'),
  'debank/tokenList': () => import('./debank/_tokenList.js'),
  'dexscreener/tokenStatsBatch': () => import('./dexscreener/_tokenStatsBatch.js'),

  'deploy/session/cancel': () => import('./deploy/session/_cancel.js'),
  'deploy/session/continue': () => import('./deploy/session/_continue.js'),
  'deploy/session/create': () => import('./deploy/session/_create.js'),
  'deploy/session/start': () => import('./deploy/session/_start.js'),
  'deploy/session/status': () => import('./deploy/session/_status.js'),
  'deploy/config': () => import('./deploy/_config.js'),
  'deploy/solanaInfraStatus': () => import('./deploy/_solanaInfraStatus.js'),
  'deploy/provisionSolanaRoute': () => import('./deploy/_provisionSolanaRoute.js'),
  'deploy/setupSolanaOvaultMesh': () => import('./deploy/_setupSolanaOvaultMesh.js'),
  'deploy/registerSolanaBridgeToken': () => import('./deploy/_registerSolanaBridgeToken.js'),
  'deploy/smartWalletOwner': () => import('./deploy/_smartWalletOwner.js'),
  'deploy/smartWalletOwners': () => import('./deploy/_smartWalletOwners.js'),

  'farcaster/me': () => import('./farcaster/_me.js'),
  'farcaster/mention': () => import('./farcaster/_mention.js'),
  'farcaster/nonce': () => import('./farcaster/_nonce.js'),
  'farcaster/verify': () => import('./farcaster/_verify.js'),

  'health': () => import('./_health.js'),

  'onchain/coinMarketRewardsByCoin': () => import('./onchain/_coinMarketRewardsByCoin.js'),
  'onchain/coinMarketRewardsCurrency': () => import('./onchain/_coinMarketRewardsCurrency.js'),
  'onchain/coinTradeRewardsBatch': () => import('./onchain/_coinTradeRewardsBatch.js'),
  'onchain/protocolRewardsClaimable': () => import('./onchain/_protocolRewardsClaimable.js'),
  'onchain/protocolRewardsWithdrawn': () => import('./onchain/_protocolRewardsWithdrawn.js'),

  'paymaster': () => import('./_paymaster.js'),
  'revert-finance': () => import('./_revert-finance.js'),

  'social/farcaster': () => import('./social/_farcaster.js'),
  'social/talent': () => import('./social/_talent.js'),
  'social/twitter': () => import('./social/_twitter.js'),

  'status/protocolReport': () => import('./status/_protocolReport.js'),
  'status/vaultReport': () => import('./status/_vaultReport.js'),

  'sync-vault-data': () => import('./_sync-vault-data.js'),
  'referrals/click': () => import('./referrals/_click.js'),
  'referrals/me': () => import('./referrals/_me.js'),
  'referrals/leaderboard': () => import('./referrals/_leaderboard.js'),
  'waitlist': () => import('./_waitlist.js'),
  'waitlist/csw-link': () => import('./waitlist/_csw-link.js'),
  'waitlist/csw-proof': () => import('./waitlist/_csw-proof.js'),
  'waitlist/ledger': () => import('./waitlist/_ledger.js'),
  'waitlist/leaderboard': () => import('./waitlist/_leaderboard.js'),
  'waitlist/agent-points-sync': () => import('./waitlist/_agent-points-sync.js'),
  'waitlist/lens-points-sync': () => import('./waitlist/_lens-points-sync.js'),
  'waitlist/me': () => import('./waitlist/_me.js'),
  'waitlist/position': () => import('./waitlist/_position.js'),
  'waitlist/preprovision': () => import('./waitlist/_preprovision.js'),
  'waitlist/profile-complete': () => import('./waitlist/_profile-complete.js'),
  'waitlist/task-claim': () => import('./waitlist/_task-claim.js'),
  'waitlist/update-email': () => import('./waitlist/_update-email.js'),
  'waitlist/verify-social': () => import('./waitlist/_verify-social.js'),
  'waitlist/verify-x': () => import('./waitlist/_verify-x.js'),
  'rpc': () => import('./rpc/_proxy.js'),
  'webhook': () => import('./_webhook.js'),

  'uniswap/query': () => import('./uniswap/_query.js'),
  'uniswap/poolHistory': () => import('./uniswap/_poolHistory.js'),
  'uniswap/quote': () => import('./uniswap/_quote.js'),
  'uniswap/zquote': () => import('./uniswap/_zquote.js'),
  'uniswap/swap': () => import('./uniswap/_swap.js'),
  'uniswap/order': () => import('./uniswap/_order.js'),
  'uniswap/checkApproval': () => import('./uniswap/_checkApproval.js'),
  'uniswap/checkDelegation': () => import('./uniswap/_checkDelegation.js'),
  'uniswap/swap5792': () => import('./uniswap/_swap5792.js'),
  'uniswap/swap7702': () => import('./uniswap/_swap7702.js'),
  'uniswap/plan': () => import('./uniswap/_plan.js'),
  'uniswap/liquidity': () => import('./uniswap/_liquidity.js'),

  // Token metadata (ERC-7572) - supports both query param and path-based addresses
  'token/metadata': () => import('./token/_metadata.js'),
  'token/image': () => import('./token/_image.js'),
  // Versioned API paths (v1/token/{address}/metadata and v1/token/{address}/image)
  // These are handled dynamically in getApiHandler below

  // Farcaster Frames
  'frames/vault': () => import('./frames/_vault.js'),
  'frames/gallery': () => import('./frames/_gallery.js'),

  'lens/mapping': () => import('./lens/_mapping.js'),
  'lens/graph': () => import('./lens/_graph.js'),
  'lens/share-token-metadata': () => import('./lens/_share-token-metadata.js'),
  'lens/agent-registration': () => import('./lens/_agent-registration.js'),
  'lens/reputation-graph': () => import('./lens/_reputation-graph.js'),
  'lens/feedback-payload': () => import('./lens/_feedback-payload.js'),

  'openclaw/tools': () => import('./openclaw/_tools.js'),
  'openclaw/execute': () => import('./openclaw/_execute.js'),

  'zora/coin': () => import('./zora/_coin.js'),
  'zora/explore': () => import('./zora/_explore.js'),
  'zora/metrics': () => import('./zora/_metrics.js'),
  'zora/profile': () => import('./zora/_profile.js'),
  'zora/profileCoins': () => import('./zora/_profileCoins.js'),
  'zora/topCreators': () => import('./zora/_topCreators.js'),

  'admin/creator-access/allowlist': () => import('./admin/creator-access/_allowlist.js'),
  'admin/creator-access/approve': () => import('./admin/creator-access/_approve.js'),
  'admin/creator-access/deny': () => import('./admin/creator-access/_deny.js'),
  'admin/creator-access/list': () => import('./admin/creator-access/_list.js'),
  'admin/creator-access/note': () => import('./admin/creator-access/_note.js'),
  'admin/creator-access/restore': () => import('./admin/creator-access/_restore.js'),
  'admin/creator-access/revoke': () => import('./admin/creator-access/_revoke.js'),
  'admin/farcaster/provider-dashboard': () => import('./admin/farcaster/_provider-dashboard.js'),
  'admin/miniapp/sendNotification': () => import('./admin/miniapp/_sendNotification.js'),
  'admin/waitlist/detail': () => import('./admin/waitlist/_detail.js'),
  'admin/waitlist/list': () => import('./admin/waitlist/_list.js'),
  'admin/waitlist/approve': () => import('./admin/waitlist/_approve.js'),
  'admin/waitlist/deny': () => import('./admin/waitlist/_deny.js'),
  'admin/waitlist/delete': () => import('./admin/waitlist/_delete.js'),
  'admin/wallet/canonical-owner-link-status': () => import('./admin/wallet/_canonicalOwnerLinkStatus.js'),
  'admin/wallet/duplicate-principals': () => import('./admin/wallet/_duplicatePrincipals.js'),
}

// Match v1/token/{address}/metadata or v1/token/{address}/image patterns
const V1_TOKEN_PATTERN = /^v1\/token\/([a-fA-F0-9x]+)\/(metadata|image)$/

// Match v1 REST patterns that embed an address in the path.
const V1_VAULT_PATTERN = /^v1\/vault\/([a-fA-F0-9x]+)\/(report|strategies)$/
const V1_AUCTION_PATTERN = /^v1\/auction\/([a-fA-F0-9x]+)\/(status|recentBids)$/
const V1_LOTTERY_CREATOR_PATTERN = /^v1\/lottery\/creator\/([a-fA-F0-9x]+)$/
const V1_GAUGE_USER_PATTERN = /^v1\/gauge\/user\/([a-fA-F0-9x]+)$/
const V1_VE4626_USER_PATTERN = /^v1\/ve4626\/user\/([a-fA-F0-9x]+)$/
const V1_CHARM_STRATEGY_PATTERN = /^v1\/charm\/strategy\/([a-fA-F0-9x]+)$/

export async function getApiHandler(subpath: string): Promise<ApiHandler | null> {
  // First, check for exact match in static routes
  const loader = apiRouteLoaders[subpath]
  if (loader) {
    const mod = await loader()
    return typeof mod?.default === 'function' ? (mod.default as ApiHandler) : null
  }

  // Handle dynamic v1 token routes: v1/token/{address}/metadata or v1/token/{address}/image
  const v1Match = subpath.match(V1_TOKEN_PATTERN)
  if (v1Match) {
    const [, address, action] = v1Match
    const routeKey = `token/${action}` as keyof typeof apiRouteLoaders
    const dynamicLoader = apiRouteLoaders[routeKey]
    if (dynamicLoader) {
      const mod = await dynamicLoader()
      const baseHandler = mod?.default
      if (typeof baseHandler === 'function') {
        // Wrap the handler to inject the address from the path into query params
        const wrappedHandler: ApiHandler = (req, res) => {
          // Inject address from path into query if not already present
          if (!req.query.address) {
            req.query.address = address
          }
          return baseHandler(req, res)
        }
        return wrappedHandler
      }
    }
  }

  // Handle dynamic v1 vault routes: v1/vault/{address}/report|strategies
  const v1VaultMatch = subpath.match(V1_VAULT_PATTERN)
  if (v1VaultMatch) {
    const [, address, action] = v1VaultMatch
    const routeKey = `v1/vault/${action}` as keyof typeof apiRouteLoaders
    const dynamicLoader = apiRouteLoaders[routeKey]
    if (dynamicLoader) {
      const mod = await dynamicLoader()
      const baseHandler = mod?.default
      if (typeof baseHandler === 'function') {
        const wrappedHandler: ApiHandler = (req, res) => {
          if (!req.query.address) req.query.address = address
          if (!req.query.vault) req.query.vault = address
          return baseHandler(req, res)
        }
        return wrappedHandler
      }
    }
  }

  // Handle dynamic v1 auction routes: v1/auction/{address}/status|recentBids
  const v1AuctionMatch = subpath.match(V1_AUCTION_PATTERN)
  if (v1AuctionMatch) {
    const [, address, action] = v1AuctionMatch
    const routeKey = `v1/auction/${action}` as keyof typeof apiRouteLoaders
    const dynamicLoader = apiRouteLoaders[routeKey]
    if (dynamicLoader) {
      const mod = await dynamicLoader()
      const baseHandler = mod?.default
      if (typeof baseHandler === 'function') {
        const wrappedHandler: ApiHandler = (req, res) => {
          if (!req.query.address) req.query.address = address
          if (action === 'status') {
            if (!req.query.ccaStrategy) req.query.ccaStrategy = address
          } else {
            if (!req.query.auction) req.query.auction = address
          }
          return baseHandler(req, res)
        }
        return wrappedHandler
      }
    }
  }

  // Handle dynamic v1 lottery creator route: v1/lottery/creator/{creatorCoin}
  const v1LotteryCreatorMatch = subpath.match(V1_LOTTERY_CREATOR_PATTERN)
  if (v1LotteryCreatorMatch) {
    const [, address] = v1LotteryCreatorMatch
    const dynamicLoader = apiRouteLoaders['v1/lottery/creator']
    if (dynamicLoader) {
      const mod = await dynamicLoader()
      const baseHandler = mod?.default
      if (typeof baseHandler === 'function') {
        const wrappedHandler: ApiHandler = (req, res) => {
          if (!req.query.address) req.query.address = address
          if (!req.query.creatorCoin) req.query.creatorCoin = address
          return baseHandler(req, res)
        }
        return wrappedHandler
      }
    }
  }

  // Handle dynamic v1 gauge user route: v1/gauge/user/{address}
  const v1GaugeUserMatch = subpath.match(V1_GAUGE_USER_PATTERN)
  if (v1GaugeUserMatch) {
    const [, address] = v1GaugeUserMatch
    const dynamicLoader = apiRouteLoaders['v1/gauge/user']
    if (dynamicLoader) {
      const mod = await dynamicLoader()
      const baseHandler = mod?.default
      if (typeof baseHandler === 'function') {
        const wrappedHandler: ApiHandler = (req, res) => {
          if (!req.query.address) req.query.address = address
          if (!req.query.user) req.query.user = address
          return baseHandler(req, res)
        }
        return wrappedHandler
      }
    }
  }

  // Handle dynamic v1 ve4626 user route: v1/ve4626/user/{address}
  const v1VeUserMatch = subpath.match(V1_VE4626_USER_PATTERN)
  if (v1VeUserMatch) {
    const [, address] = v1VeUserMatch
    const dynamicLoader = apiRouteLoaders['v1/ve4626/user']
    if (dynamicLoader) {
      const mod = await dynamicLoader()
      const baseHandler = mod?.default
      if (typeof baseHandler === 'function') {
        const wrappedHandler: ApiHandler = (req, res) => {
          if (!req.query.address) req.query.address = address
          if (!req.query.user) req.query.user = address
          return baseHandler(req, res)
        }
        return wrappedHandler
      }
    }
  }

  // Handle dynamic v1 charm strategy route: v1/charm/strategy/{address}
  const v1CharmMatch = subpath.match(V1_CHARM_STRATEGY_PATTERN)
  if (v1CharmMatch) {
    const [, address] = v1CharmMatch
    const dynamicLoader = apiRouteLoaders['v1/charm/strategy']
    if (dynamicLoader) {
      const mod = await dynamicLoader()
      const baseHandler = mod?.default
      if (typeof baseHandler === 'function') {
        const wrappedHandler: ApiHandler = (req, res) => {
          if (!req.query.address) req.query.address = address
          if (!req.query.strategy) req.query.strategy = address
          return baseHandler(req, res)
        }
        return wrappedHandler
      }
    }
  }

  return null
}
