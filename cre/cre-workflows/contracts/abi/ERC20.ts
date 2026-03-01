/**
 * Minimal ERC-20 ABI fragment for balance checks.
 */

export const ERC20ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const
