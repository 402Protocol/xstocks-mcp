#!/usr/bin/env node
/**
 * xstocks-mcp — standalone MCP server (stdio).
 *
 * 9 tools: wallet_create, wallet_verify_backup, xstocks_list, xstocks_quote,
 * xstocks_buy, xstocks_sell, xstocks_balance, xstocks_basket_buy,
 * xstocks_basket_sell.
 *
 * Env:
 *   ZEROX_API_KEY              free 0x API key (required for quotes/trades)
 *   FOUR02_INK_RPC_URL         Ink RPC override (default: public endpoint)
 *   FOUR02_XSTOCKS_FEE_BPS     integrator fee bps 0-1000 (default 25)
 *   FOUR02_XSTOCKS_FEE_RECIPIENT  fee recipient (default: 402 treasury)
 *
 * Run: npm run mcp   (or: npx -y tsx src/server.ts)
 */
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { INK_RPC_URL } from './constants.js';
import { registerWalletTools } from './wallet.js';
import { registerXstocksTools } from './xstocks.js';

export function createServer(inkRpcUrl?: string): McpServer {
  const server = new McpServer(
    { name: 'xstocks-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  registerWalletTools(server);
  registerXstocksTools(server, {
    inkRpcUrl: (inkRpcUrl ?? process.env.FOUR02_INK_RPC_URL ?? '').trim() || INK_RPC_URL,
  });
  return server;
}

async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}

// Only boot stdio when run directly (`npx tsx src/server.ts`); importing
// this module (e.g. from tests) just gets the factory.
const invokedAs = process.argv[1];
if (invokedAs && import.meta.url === pathToFileURL(invokedAs).href) {
  await main();
}
