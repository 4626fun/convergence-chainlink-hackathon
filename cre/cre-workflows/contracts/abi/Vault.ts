/**
 * CreatorOVault ABI fragments — only the functions used by CRE workflows.
 *
 * Extracted from cre/config.ts for use with viem's type-safe contract
 * interactions inside CRE SDK workflows.
 */

export const VaultABI = [
  // Read
  {
    type: "function",
    name: "coinBalance",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deploymentThreshold",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "minimumTotalIdle",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalStrategyWeight",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "lastReport",
    inputs: [],
    outputs: [{ type: "uint96" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isShutdown",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "keeper",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAssets",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalAssetsAtLastReport",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  // Write
  {
    type: "function",
    name: "tend",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "report",
    inputs: [],
    outputs: [{ type: "uint256" }, { type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "deployToStrategies",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const
