/**
 * CRE Workflow: Vault Keeper
 *
 * Reads vault state from Base mainnet via EVMClient, evaluates whether
 * tend() or report() should be called, and delegates the write to the
 * Vercel API HTTP bridge.
 *
 * CRE Quota Budget per execution:
 *   - 1 HTTP call: GET /cre/vaults/active?limit=1 (fetch 1 vault)
 *   - Up to 10 EVM reads: vault state fields (coinBalance, deploymentThreshold, etc.)
 *   - Up to 2 HTTP calls: POST /cre/keeper/tend and/or POST /cre/keeper/report
 *   Total: 3 HTTP calls + 10 EVM reads (within CRE limits)
 *
 * Processes 1 vault per execution. Runs every 5 minutes.
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
import { VaultABI } from "../contracts/abi"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

type Config = {
  schedule: string
  apiBaseUrl: string
  chainName: string
  reportIntervalSeconds: number
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
}

type VaultState = {
  coinBalance: bigint
  deploymentThreshold: bigint
  minimumTotalIdle: bigint
  totalStrategyWeight: bigint
  lastReport: bigint
  isShutdown: boolean
  paused: boolean
  totalAssets: bigint
}

type KeeperResult = {
  vaultAddress: string
  tended: boolean
  reported: boolean
  skippedReason: string
  error: string
}

// ---------------------------------------------------------------------------
// EVM read helpers
// ---------------------------------------------------------------------------

type VaultReadFn = typeof VaultABI[number]["name"]

function readVaultField(
  runtime: Runtime<Config>,
  evmClient: EVMClient,
  vaultAddress: string,
  functionName: VaultReadFn,
): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const callData = encodeFunctionData({ abi: VaultABI, functionName } as any)

  const result = evmClient
    .callContract(runtime, {
      call: encodeCallMsg({
        from: zeroAddress,
        to: vaultAddress as `0x${string}`,
        data: callData,
      }),
      blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
    })
    .result()

  return result.data
}

function decodeBigInt(data: Uint8Array, functionName: VaultReadFn): bigint {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return decodeFunctionResult({ abi: VaultABI, functionName, data: bytesToHex(data) } as any) as bigint
}

function decodeBool(data: Uint8Array, functionName: VaultReadFn): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return decodeFunctionResult({ abi: VaultABI, functionName, data: bytesToHex(data) } as any) as boolean
}

// ---------------------------------------------------------------------------
// Decision logic (pure computation — no CRE quota cost)
// ---------------------------------------------------------------------------

function shouldTend(state: VaultState): boolean {
  if (state.isShutdown || state.paused) return false
  if (state.totalStrategyWeight === 0n) return false

  const minIdle =
    state.minimumTotalIdle > state.deploymentThreshold
      ? state.minimumTotalIdle
      : state.deploymentThreshold

  return state.coinBalance > minIdle
}

function shouldReport(
  state: VaultState,
  reportIntervalSeconds: number,
  nowSeconds: bigint,
): boolean {
  if (state.isShutdown || state.paused) return false
  if (state.totalStrategyWeight === 0n) return false

  const secondsSinceReport = nowSeconds - state.lastReport
  return secondsSinceReport > BigInt(reportIntervalSeconds)
}

// ---------------------------------------------------------------------------
// HTTP helper — fetch vault list (runs in node mode)
// ---------------------------------------------------------------------------

function encodeJsonBody(payload: unknown): string {
  const json = JSON.stringify(payload)
  if (typeof btoa === "function") return btoa(json)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeBuffer = (globalThis as any).Buffer
  if (maybeBuffer?.from) return maybeBuffer.from(json, "utf8").toString("base64")
  throw new Error("base64_encoder_unavailable")
}

function fetchVaultListJson(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
): string {
  const baseUrl = nodeRuntime.config.apiBaseUrl

  const resp = httpClient.sendRequest(nodeRuntime, {
    url: `${baseUrl}/cre/vaults/active?chainId=8453&limit=1`,
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  }).result()

  return new TextDecoder().decode(resp.body)
}

// ---------------------------------------------------------------------------
// HTTP helper — send write request via bridge (runs in node mode)
// ---------------------------------------------------------------------------

function sendBridgeRequest(
  nodeRuntime: NodeRuntime<Config>,
  httpClient: HTTPClient,
  apiKey: string,
  endpoint: string,
  payload: Record<string, string>,
): boolean {
  const baseUrl = nodeRuntime.config.apiBaseUrl

  const resp = httpClient.sendRequest(nodeRuntime, {
    url: `${baseUrl}/cre/keeper/${endpoint}`,
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

const onCronTrigger = (runtime: Runtime<Config>): KeeperResult => {
  const apiKeySecret = runtime.getSecret({ id: "KEEPR_API_KEY" }).result()
  const apiKey = apiKeySecret.value

  runtime.log("Vault keeper starting")

  // Step 1: Fetch vault list via HTTP (1 HTTP call)
  const httpClient = new HTTPClient()
  const vaultsJson = runtime.runInNodeMode(
    (nr: NodeRuntime<Config>) => fetchVaultListJson(nr, httpClient, apiKey),
    consensusIdenticalAggregation(),
  )().result()
  const parsed = JSON.parse(vaultsJson) as {
    success: boolean
    data?: { vaults: VaultInfo[] }
  }
  const vaults: VaultInfo[] = parsed.success && parsed.data ? parsed.data.vaults : []

  if (vaults.length === 0) {
    runtime.log("No vaults found")
    return {
      vaultAddress: "",
      tended: false,
      reported: false,
      skippedReason: "no_vaults",
      error: "",
    }
  }

  const vault = vaults[0]
  const addr = vault.vaultAddress
  runtime.log(`Processing vault ${addr}`)

  // Step 2: Read vault state via EVMClient (up to 8 EVM reads)
  const evmClient = new EVMClient(BASE_MAINNET_CHAIN_SELECTOR)

  const coinBalanceData = readVaultField(runtime, evmClient, addr, "coinBalance")
  const deploymentThresholdData = readVaultField(runtime, evmClient, addr, "deploymentThreshold")
  const minimumTotalIdleData = readVaultField(runtime, evmClient, addr, "minimumTotalIdle")
  const totalStrategyWeightData = readVaultField(runtime, evmClient, addr, "totalStrategyWeight")
  const lastReportData = readVaultField(runtime, evmClient, addr, "lastReport")
  const isShutdownData = readVaultField(runtime, evmClient, addr, "isShutdown")
  const pausedData = readVaultField(runtime, evmClient, addr, "paused")
  const totalAssetsData = readVaultField(runtime, evmClient, addr, "totalAssets")

  const state: VaultState = {
    coinBalance: decodeBigInt(coinBalanceData, "coinBalance"),
    deploymentThreshold: decodeBigInt(deploymentThresholdData, "deploymentThreshold"),
    minimumTotalIdle: decodeBigInt(minimumTotalIdleData, "minimumTotalIdle"),
    totalStrategyWeight: decodeBigInt(totalStrategyWeightData, "totalStrategyWeight"),
    lastReport: decodeBigInt(lastReportData, "lastReport"),
    isShutdown: decodeBool(isShutdownData, "isShutdown"),
    paused: decodeBool(pausedData, "paused"),
    totalAssets: decodeBigInt(totalAssetsData, "totalAssets"),
  }

  // Guard: vault is shutdown or paused
  if (state.isShutdown) {
    runtime.log(`Vault ${addr} is shutdown — skipping`)
    return {
      vaultAddress: addr,
      tended: false,
      reported: false,
      skippedReason: "vault_shutdown",
      error: "",
    }
  }
  if (state.paused) {
    runtime.log(`Vault ${addr} is paused — skipping`)
    return {
      vaultAddress: addr,
      tended: false,
      reported: false,
      skippedReason: "vault_paused",
      error: "",
    }
  }

  // Step 3: Decision logic
  const nowSeconds = BigInt(Math.floor(runtime.now().getTime() / 1000))
  const needsTend = shouldTend(state)
  const needsReport = shouldReport(state, runtime.config.reportIntervalSeconds, nowSeconds)

  let tended = false
  let reported = false

  // Step 4: Execute writes via HTTP bridge
  if (needsTend) {
    runtime.log(`Calling tend() for ${addr} via HTTP bridge`)
    tended = runtime.runInNodeMode(
      (nr: NodeRuntime<Config>) =>
        sendBridgeRequest(nr, httpClient, apiKey, "tend", { vaultAddress: addr }),
      consensusIdenticalAggregation(),
    )().result()
    runtime.log(`tend() ${tended ? "succeeded" : "failed"}`)
  }

  if (needsReport) {
    runtime.log(`Calling report() for ${addr} via HTTP bridge`)
    reported = runtime.runInNodeMode(
      (nr: NodeRuntime<Config>) =>
        sendBridgeRequest(nr, httpClient, apiKey, "report", { vaultAddress: addr }),
      consensusIdenticalAggregation(),
    )().result()
    runtime.log(`report() ${reported ? "succeeded" : "failed"}`)
  }

  if (!needsTend && !needsReport) {
    runtime.log(`No action needed for ${addr}`)
  }

  return {
    vaultAddress: addr,
    tended,
    reported,
    skippedReason: "",
    error: "",
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
