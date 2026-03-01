/**
 * Zora Creator Coin ABI fragment for CRE payout-integrity workflow.
 *
 * Only the payoutRecipient() view function needed for monitoring.
 */

export const CreatorCoinABI = [
  {
    type: "function",
    name: "payoutRecipient",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
] as const
