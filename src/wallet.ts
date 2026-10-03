/**
 * Wallet tools — the agent's own Ink wallet.
 *
 * The server generates keypairs and verifies backups, but NEVER stores,
 * logs, or transmits private keys. The key exists only in the tool response
 * to the calling agent; the human must back it up to durable secret storage
 * and prove the backup before any funding or trading happens.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';
import { CHAIN_ID } from './constants.js';

function textResult(value: unknown): { content: { type: 'text'; text: string }[] } {
  const text = JSON.stringify(
    value,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
    2,
  );
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string, detail?: unknown) {
  return textResult({ ok: false, error: message, ...(detail !== undefined ? { detail } : {}) });
}

// --- EXPORTED HANDLERS FOR TESTING ---

export async function handleWalletCreate() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return textResult({
    ok: true,
    address: account.address,
    privateKey,
    chainId: CHAIN_ID,
    backup_steps: [
      '1. Write the private key to durable SECRET storage RIGHT NOW (your secure vault, encrypted disk, or secret manager) — never chat, logs, or code.',
      '2. Reload the key FROM that storage and call wallet_verify_backup with the reloaded key and this address. It proves your backup actually reproduces the wallet.',
      '3. Only after wallet_verify_backup reports matches:true, fund the wallet with gas + USDC.',
    ],
    warning:
      'This private key was generated just now and exists ONLY in this response. ' +
      'The server did not store it: there is no recovery. If the key is lost before step 1, ' +
      'the wallet and everything in it is gone forever. Do NOT fund the wallet until ' +
      'wallet_verify_backup passes.',
  });
}

export async function handleWalletVerifyBackup(args: {
  privateKey: string;
  expectedAddress: string;
}) {
  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(args.privateKey)) {
      return errorResult('invalid_private_key', 'expected 0x-prefixed 32-byte hex');
    }
    if (!isAddress(args.expectedAddress)) {
      return errorResult('invalid_expected_address', 'expected an EVM address');
    }
    const derived = getAddress(
      privateKeyToAccount(args.privateKey as `0x${string}`).address,
    );
    const expected = getAddress(args.expectedAddress);
    const matches = derived === expected;
    return textResult({
      ok: true,
      derivedAddress: derived,
      expectedAddress: expected,
      matches,
      next: matches
        ? 'Backup verified — the reloaded key reproduces the wallet. It is now safe to fund it.'
        : 'MISMATCH — the reloaded key does NOT reproduce the expected wallet. Do NOT fund; restore the correct key from your backup and try again.',
    });
  } catch (e) {
    return errorResult('verification_failed', (e as Error).message);
  }
}

// --- MCP REGISTRATION ---

export function registerWalletTools(server: McpServer) {
  server.registerTool(
    'wallet_create',
    {
      description:
        'Generate a fresh Ink (EVM) wallet for this agent: a random secp256k1 keypair. The private key is returned to YOU, the caller, over this local connection and is NEVER stored, logged, or transmitted anywhere by this server. Ritual: (1) back the key up to durable secret storage IMMEDIATELY, (2) reload it from that storage and prove it with wallet_verify_backup, (3) only then fund the wallet. Skip the ritual and you risk losing the wallet and everything in it — there is no recovery. The wallet starts empty: fund it with a little ETH (gas) and USDC on Ink (chain 57073) before trading. No arguments.',
    },
    async () => handleWalletCreate(),
  );

  server.registerTool(
    'wallet_verify_backup',
    {
      description:
        'Prove a backed-up wallet key actually works: derive the address from a private key you reloaded from your OWN durable storage and check it matches the expected address from wallet_create. Call this BEFORE funding a new wallet — funding a wallet you cannot recover burns money. The key is used only to derive the address and is never stored, logged, or transmitted anywhere.',
      inputSchema: {
        privateKey: z.string(),
        expectedAddress: z.string(),
      },
    },
    async (args) => handleWalletVerifyBackup(args),
  );
}