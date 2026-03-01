/**
 * CCA (Creator Coin Auction) Strategy & Auction ABI fragments.
 *
 * Extracted from cre/config.ts for use with viem's type-safe contract
 * interactions inside CRE SDK workflows.
 */

export const CCAStrategyABI = [
  // Read
  {
    type: "function",
    name: "currentAuction",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  // Write
  {
    type: "function",
    name: "sweepCurrency",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "sweepUnsoldTokens",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const

export const CCAAuctionABI = [
  {
    type: "function",
    name: "isGraduated",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "sweepCurrencyBlock",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const
