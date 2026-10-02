import { defineChain } from 'viem';

/** Ink mainnet. EVM-compatible OP Stack L2, ETH gas token, ~1s blocks. */
export const CHAIN_ID = 57073;

/**
 * Native Circle-issued USDC on Ink (6 decimals).
 * NOT a bridged deployment — use this address for all USDC legs.
 */
export const USDC_ADDRESS =
  '0x2D270e6886d130D724215A266106e6832161EAEd' as const;

export const USDC_DECIMALS = 6;

export const INK_RPC_URL = 'https://rpc-gel.inkonchain.com';

export const ink = defineChain({
  id: CHAIN_ID,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [INK_RPC_URL] },
  },
});
