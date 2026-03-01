/**
 * VaultShareBurnStream ABI fragments for CRE payout-integrity workflow.
 *
 * Only includes the read-only functions needed for monitoring.
 */

export const BurnStreamABI = [
  {
    type: "function",
    name: "activeShares",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "burnedActive",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "activeEpochStart",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingShares",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingEpochStart",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const
