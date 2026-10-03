/**
 * 0x v2 swap quoter — pure TypeScript, no external helpers.
 *
 * Hits `https://api.0x.org/swap/allowance-holder/quote` directly (Ink = chain
 * 57073) with a `0x-API-Key` header read from the `ZEROX_API_KEY` env var.
 * The key never appears in code, logs, or output — it travels only as an
 * HTTP header on the quote request.
 *
 * Read-only: nothing is signed or broadcast. The caller signs the returned
 * transaction client-side.
 */
import type { Address, Hex } from 'viem';
import { getAddress } from 'viem';
import { CHAIN_ID } from './constants.js';

const QUOTE_URL = 'https://api.0x.org/swap/allowance-holder/quote';
const PRICE_URL = 'https://api.0x.org/swap/allowance-holder/price';

/** Fail fast with a clear, actionable message when the key is missing. */
export function zeroxApiKey(): string {
  const key = (process.env.ZEROX_API_KEY ?? '').trim();
  if (!key) {
    throw new Error(
      'ZEROX_API_KEY is not set. Get a free 0x API key at https://0x.org/products/swap ' +
        '(sign up, open the dashboard, create a key) and then run:\n' +
        '  export ZEROX_API_KEY=your-key-here\n' +
        'before starting the MCP server.',
    );
  }
  return key;
}

export interface ZeroxPrice {
  buyAmount: string;
  sellAmount: string;
  estimatedPriceImpact?: string | null;
  liquidityAvailable?: boolean;
}

export interface ZeroxQuoteTx {
  to: Address;
  data: Hex;
  value: string;
  gas?: string;
  gasPrice?: string;
}

export interface ZeroxIntegratorFee {
  amount: string;
  token: Address;
}

export interface ZeroxQuote extends ZeroxPrice {
  transaction: ZeroxQuoteTx;
  allowanceSpender?: Address;
  integratorFee?: ZeroxIntegratorFee;
}

export interface ZeroxPriceOptions {
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
}

/** Raw API response interface for the price endpoint */
interface ZeroxPriceApiResponse {
  buyAmount: string;
  sellAmount: string;
  estimatedPriceImpact?: string | null;
  liquidityAvailable?: boolean;
}

/**
 * Indicative price read — no taker, no calldata. The 0x v2 price endpoint
 * does not require a taker, so quotes stay wallet-free.
 */
export async function zeroxPrice(opts: ZeroxPriceOptions): Promise<ZeroxPrice> {
  const apiKey = zeroxApiKey(); // throws before any network if missing

  const params = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken: opts.sellToken,
    buyToken: opts.buyToken,
    sellAmount: opts.sellAmount.toString(),
  });

  const res = await fetch(`${PRICE_URL}?${params}`, {
    headers: {
      Accept: 'application/json',
      '0x-version': 'v2',
      '0x-API-Key': apiKey,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`0x price failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  
  // ✅ FIX: Replaced 'any' with strict TypeScript interface
  const data = (await res.json()) as ZeroxPriceApiResponse;
  
  if (!data.buyAmount) {
    throw new Error(
      `No 0x liquidity for ${opts.sellToken} -> ${opts.buyToken}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return {
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount,
    estimatedPriceImpact: data.estimatedPriceImpact,
    liquidityAvailable: data.liquidityAvailable,
  };
}

export interface ZeroxQuoteOptions {
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  /** Taker wallet — required by the 0x v2 API on every quote call, price or not. */
  taker: Address;
  slippageBps?: number;
  /** Integrator fee in bps (0-1000). Applied on the stock leg only by the caller. */
  feeBps?: number;
  /** Required when feeBps > 0. */
  feeRecipient?: Address;
}

/** Raw API response interface for the quote endpoint */
interface ZeroxQuoteApiResponse {
  buyAmount: string;
  sellAmount: string;
  estimatedPriceImpact?: string | null;
  liquidityAvailable?: boolean;
  transaction?: {
    to: string;
    data: string;
    value?: string;
    gas?: string;
    gasPrice?: string;
  };
  issues?: {
    allowance?: {
      spender?: string;
    };
  };
  fees?: {
    integratorFee?: {
      amount?: string;
      token?: string;
    };
  };
}

export async function zeroxQuote(opts: ZeroxQuoteOptions): Promise<ZeroxQuote> {
  const apiKey = zeroxApiKey(); // throws before any network if missing

  const feeBps = opts.feeBps ?? 0;
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) {
    throw new Error('feeBps must be an integer 0-1000');
  }
  if (feeBps > 0 && !opts.feeRecipient) {
    throw new Error('feeRecipient is required when feeBps > 0');
  }

  const params = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken: opts.sellToken,
    buyToken: opts.buyToken,
    sellAmount: opts.sellAmount.toString(),
    slippageBps: String(opts.slippageBps ?? 100),
  });
  params.set('taker', opts.taker);
  if (feeBps > 0) {
    params.set('swapFeeBps', String(feeBps));
    params.set('swapFeeRecipient', opts.feeRecipient!);
  }

  const res = await fetch(`${QUOTE_URL}?${params}`, {
    headers: {
      Accept: 'application/json',
      '0x-version': 'v2',
      '0x-API-Key': apiKey,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`0x quote failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  
  // ✅ FIX: Replaced 'any' with strict TypeScript interface
  const data = (await res.json()) as ZeroxQuoteApiResponse;
  
  if (!data.buyAmount) {
    throw new Error(
      `No 0x liquidity for ${opts.sellToken} -> ${opts.buyToken}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }

  // ✅ FIX: Safe property access to satisfy TypeScript and prevent runtime crashes
  if (!data.transaction || !data.transaction.to || !data.transaction.data) {
    throw new Error('0x quote returned invalid or missing transaction data');
  }

  const tx = data.transaction;
  const integrator = data.fees?.integratorFee;

  return {
    buyAmount: data.buyAmount,
    sellAmount: data.sellAmount,
    estimatedPriceImpact: data.estimatedPriceImpact,
    liquidityAvailable: data.liquidityAvailable,
    transaction: {
      to: getAddress(tx.to),
      data: tx.data as Hex,
      value: tx.value ?? '0',
      gas: tx.gas,
      gasPrice: tx.gasPrice,
    },
    allowanceSpender: data.issues?.allowance?.spender
      ? getAddress(data.issues.allowance.spender)
      : undefined,
    integratorFee: (integrator?.amount && integrator.token)
      ? { amount: integrator.amount, token: getAddress(integrator.token) }
      : undefined,
  };
}