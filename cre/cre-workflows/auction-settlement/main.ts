/**
 * CRE Workflow: Auction Settlement (Smart Polling)
 *
 * Graduation is a one-time event ~7 days after vault deployment. This
 * workflow runs hourly (not every 5 min) and only fetches vaults that
 * have NOT been marked as settled in the DB.
 *
 * Flow:
 *   1. HTTP: GET /cre/vaults/active?settled=false&chainId=8453
 *   2. EVM:  currentAuction(), isGraduated(), sweepCurrencyBlock()
 *   3. HTTP: POST /cre/keeper/sweep (if graduated + not yet swept)
 *   4. HTTP: POST /cre/keeper/mark-settled (record timestamps)
 *
 * CRE Quota Budget per execution:
 *   - 1 HTTP (fetch unsettled vaults)
 *   - 3 EVM reads (currentAuction, isGraduated, sweepCurrencyBlock)
 *   - 1 HTTP (sweep) — only if needed
 *   - 1 HTTP (mark-settled) — only if state changed
 *   Total: max 3 HTTP + 3 EVM reads (well within CRE limits)
 */

import {
  CronCapability,
  EVMClient,
  HTTPClient,
  handler,
  Runner,
  type Runtime,
  type NodeRuntime,
  LAST_FINALIZED_BLOCK_NUMBER,
  encodeCallMsg,
  bytesToHex,
  consensusIdenticalAggregation,
} from "@chainlink/cre-sdk"
import { encodeFunctionData, decodeFunctionResult, zeroAddress } from "viem"
import { CCAStrategyABI, CCAAuctionABI } from "../contracts/abi"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type Config = {
  schedule: string
  apiBaseUrl: string
  chainName: string
}

// ---------------------------------------------------------------------------
// Chain selector for Base mainnet
// ---------------------------------------------------------------------------

const BASE_MAINNET_CHAIN_SELECTOR =
  EVMClient.SUPPORTED_CHAIN_SELECTORS["ethereum-mainnet-base-1"]

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VaultInfo = {
  vaultAddress: string
  chainId: number
  ccaStrategyAddress?: string
  graduatedAt?: string | null
  settledAt?: string | null
}

type SettlementResult = {
  vaultAddress: string
  ccaStrategyAddress: string
  auctionAddress: string
  graduated: boolean
  alreadySwept: boolean
  swept: boolean
  markedSettled: boolean
  skippedReason: string
  error: string
}

// ---------------------------------------------------------------------------
// EVM read helpers
// ---------------------------------------------------------------------------

function readContractField(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  address: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  abi: any,
  functionName: string,
): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callData = encodeFunctionData({ abi, functionName } as any)

  return evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: address as `0x${string}`,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result().data
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function encodeJsonBody(payload: unknown): string {
  const json = JSON.stringify(payload)
  if (typeof btoa === "function") return btoa(json)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeBuffer = (globalThis as any).Buffer
  if (maybeBuffer?.from) return maybeBuffer.from(json, "utf8").toString("base64")
  throw new Error("base64_encoder_unavailable")
}

function fetchUnsettledVaultsJson(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
): string {
  const baseUrl = nodeRuntime.config.apiBaseUrl

  const resp = httpClient.sendRequest(nodeRuntime, {
    url: `${baseUrl}/cre/vaults/active?settled=false&chainId=8453`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  }).result()

  return new TextDecoder().decode(resp.body)
}

function sendSweepRequest(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
  ccaStrategyAddress: string,
): boolean {
  const baseUrl = nodeRuntime.config.apiBaseUrl

  const resp = httpClient.sendRequest(nodeRuntime, {
    url: `${baseUrl}/cre/keeper/sweep`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: encodeJsonBody({ ccaStrategyAddress }),
  }).result()

  const body = JSON.parse(new TextDecoder().decode(resp.body)) as {
    success: boolean
  }

  return body.success
}

function markSettled(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
  vaultAddress: string,
  graduatedAt?: string,
  settledAt?: string,
): boolean {
  const baseUrl = nodeRuntime.config.apiBaseUrl

  const payload: Record<string, string> = { vaultAddress }
  if (graduatedAt) payload.graduatedAt = graduatedAt
  if (settledAt) payload.settledAt = settledAt

  const resp = httpClient.sendRequest(nodeRuntime, {
    url: `${baseUrl}/cre/keeper/mark-settled`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: encodeJsonBody(payload),
  }).result()

  const body = JSON.parse(new TextDecoder().decode(resp.body)) as {
    success: boolean
  }

  return body.success
}

// ---------------------------------------------------------------------------
// CRE Callback
// ---------------------------------------------------------------------------

const onCronTrigger = (runtime: Runtime<Config>): SettlementResult => {
  const apiKeySecret = runtime.getSecret({ id: "KEEPR_API_KEY" }).result()
  const apiKey = apiKeySecret.value

  runtime.log("Auction settlement (smart polling) starting")

  // Step 1: Fetch only unsettled vaults
  const httpClient = new HTTPClient()
  const vaultsJson = runtime.runInNodeMode(
    (nr: NodeRuntime<Config>) => fetchUnsettledVaultsJson(nr, httpClient, apiKey),
    consensusIdenticalAggregation(),
  )().result()

  const parsed = JSON.parse(vaultsJson) as {
    success: boolean
    data?: { vaults: VaultInfo[] }
  }
  const vaults: VaultInfo[] = parsed.success && parsed.data ? parsed.data.vaults : []

  // Find the first vault with a CCA strategy
  const vault = vaults.find((v) => v.ccaStrategyAddress)
  if (!vault || !vault.ccaStrategyAddress) {
    runtime.log("No unsettled vaults with CCA strategy found")
    return {
      vaultAddress: "",
      ccaStrategyAddress: "",
      auctionAddress: "",
      graduated: false,
      alreadySwept: false,
      swept: false,
      markedSettled: false,
      skippedReason: "no_unsettled_cca_vaults",
      error: "",
    }
  }

  const ccaAddr = vault.ccaStrategyAddress
  runtime.log(`Processing CCA strategy ${ccaAddr} for vault ${vault.vaultAddress}`)

  // Step 2: Read auction state via EVMClient
  const evmClient = new EVMClient(BASE_MAINNET_CHAIN_SELECTOR)

  // Read currentAuction()
  const auctionData = readContractField(runtime, evmClient, ccaAddr, CCAStrategyABI, "currentAuction")
  const auctionAddress = decodeFunctionResult({
    abi: CCAStrategyABI,
    functionName: "currentAuction",
    data: bytesToHex(auctionData),
  }) as `0x${string}`

  if (auctionAddress === zeroAddress) {
    runtime.log("No active auction — skipping")
    return {
      vaultAddress: vault.vaultAddress,
      ccaStrategyAddress: ccaAddr,
      auctionAddress: zeroAddress,
      graduated: false,
      alreadySwept: false,
      swept: false,
      markedSettled: false,
      skippedReason: "no_active_auction",
      error: "",
    }
  }

  // Read isGraduated()
  const graduatedData = readContractField(runtime, evmClient, auctionAddress, CCAAuctionABI, "isGraduated")
  const isGraduated = decodeFunctionResult({
    abi: CCAAuctionABI,
    functionName: "isGraduated",
    data: bytesToHex(graduatedData),
  }) as boolean

  if (!isGraduated) {
    runtime.log(`Auction ${auctionAddress} not yet graduated — skipping`)
    return {
      vaultAddress: vault.vaultAddress,
      ccaStrategyAddress: ccaAddr,
      auctionAddress,
      graduated: false,
      alreadySwept: false,
      swept: false,
      markedSettled: false,
      skippedReason: "not_graduated",
      error: "",
    }
  }

  // Read sweepCurrencyBlock() — if non-zero, already swept on-chain
  const sweepBlockData = readContractField(runtime, evmClient, auctionAddress, CCAAuctionABI, "sweepCurrencyBlock")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sweepCurrencyBlock = decodeFunctionResult({ abi: CCAAuctionABI, functionName: "sweepCurrencyBlock", data: bytesToHex(sweepBlockData) } as any) as bigint

  const nowIso = new Date().toISOString()

  if (sweepCurrencyBlock > 0n) {
    // Already swept on-chain — just mark in DB and skip
    runtime.log(`Auction already swept at block ${sweepCurrencyBlock} — marking settled in DB`)
    const marked = runtime.runInNodeMode(
      (nr: NodeRuntime<Config>) =>
        markSettled(nr, httpClient, apiKey, vault.vaultAddress, nowIso, nowIso),
      consensusIdenticalAggregation(),
    )().result()

    return {
      vaultAddress: vault.vaultAddress,
      ccaStrategyAddress: ccaAddr,
      auctionAddress,
      graduated: true,
      alreadySwept: true,
      swept: false,
      markedSettled: marked,
      skippedReason: "already_swept_onchain",
      error: "",
    }
  }

  // Step 3: Graduated but not yet swept — execute sweep
  runtime.log(`Auction ${auctionAddress} graduated — calling sweep via HTTP bridge`)

  // Record graduation timestamp
  runtime.runInNodeMode(
    (nr: NodeRuntime<Config>) =>
      markSettled(nr, httpClient, apiKey, vault.vaultAddress, nowIso),
    consensusIdenticalAggregation(),
  )().result()

  const swept = runtime.runInNodeMode(
    (nr: NodeRuntime<Config>) =>
      sendSweepRequest(nr, httpClient, apiKey, ccaAddr),
    consensusIdenticalAggregation(),
  )().result()

  // Step 4: If sweep succeeded, mark as fully settled
  let markedSettled = false
  if (swept) {
    runtime.log("Sweep succeeded — marking vault as settled")
    markedSettled = runtime.runInNodeMode(
      (nr: NodeRuntime<Config>) =>
        markSettled(nr, httpClient, apiKey, vault.vaultAddress, undefined, nowIso),
      consensusIdenticalAggregation(),
    )().result()
  } else {
    runtime.log("Sweep failed — will retry next hour")
  }

  return {
    vaultAddress: vault.vaultAddress,
    ccaStrategyAddress: ccaAddr,
    auctionAddress,
    graduated: true,
    alreadySwept: false,
    swept,
    markedSettled,
    skippedReason: "",
    error: swept ? "" : "sweep_failed",
  }
}

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

const initWorkflow = (config: Config) => {
  const cron = new CronCapability()
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}
