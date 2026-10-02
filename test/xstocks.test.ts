/**
 * xstocks-mcp smoke tests — NO live network calls.
 *
 *   npm test
 *
 * Covers: tool registration (exactly 9 tools), the missing-ZEROX_API_KEY
 * fail-fast error, integrator-fee config math, basket equal-weight splitting,
 * the backup-gate ritual refusal, and the wallet create/verify round trip.
 * Quote/trade building is exercised only up to the missing-key error so the
 * suite runs offline and without credentials.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getAddress, isAddress } from 'viem';
import { createServer } from '../src/server.js';
import {
  DEFAULT_FEE_RECIPIENT,
  XSTOCK_BASKETS,
  XSTOCK_POOLS,
  loadXstocksFeeConfig,
  splitEqualWeight,
} from '../src/xstocks.js';

// Make sure no stray key leaks in and the missing-key path is deterministic.
delete process.env.ZEROX_API_KEY;

const server = createServer();
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'xstocks-mcp-test-client', version: '0.1.0' });
await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

function textOf(res: any): any {
  const t = res?.content?.[0]?.text;
  assert.ok(t, 'tool returned no text content');
  return JSON.parse(t);
}

const PROBE_WALLET = getAddress('0xB17e7B5e6B5e1777dD62c583C9D4AfFB183f2D7E');

test('server registers exactly 9 tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'wallet_create',
    'wallet_verify_backup',
    'xstocks_balance',
    'xstocks_basket_buy',
    'xstocks_basket_sell',
    'xstocks_buy',
    'xstocks_list',
    'xstocks_quote',
    'xstocks_sell',
  ]);
});

test('xstocks_list returns 9 pools + 3 baskets', async () => {
  const d = textOf(await client.callTool({ name: 'xstocks_list', arguments: {} }));
  assert.equal(d.ok, true);
  assert.equal(d.pools.length, 9);
  assert.ok(d.pools.every((p: any) => isAddress(p.wrappedToken) && p.poolId.startsWith('0x')));
  assert.deepEqual(Object.keys(d.baskets).sort(), ['all', 'bigtech', 'yolo']);
  assert.equal(d.baskets.all.tickers.length, 9);
  assert.deepEqual(d.baskets.bigtech.tickers, ['AAPL', 'NVDA', 'TSLA', 'AMZN', 'GOOGL']);
});

test('xstocks_quote without ZEROX_API_KEY fails with a clear error', async () => {
  const res: any = await client.callTool({
    name: 'xstocks_quote',
    arguments: { ticker: 'AAPL', amountUsd: '10' },
  });
  assert.equal(res.isError, true);
  const text = String(res.content?.[0]?.text);
  assert.match(text, /ZEROX_API_KEY is not set/);
  assert.match(text, /0x\.org/);
});

test('xstocks_quote rejects unknown ticker before any network', async () => {
  const res: any = await client.callTool({
    name: 'xstocks_quote',
    arguments: { ticker: 'MSFT', amountUsd: '10' },
  });
  assert.equal(res.isError, true);
  assert.match(String(res.content?.[0]?.text), /Unknown ticker/);
});

for (const [tool, args] of [
  ['xstocks_buy', { ticker: 'AAPL', amountUsd: '10', walletAddress: PROBE_WALLET, backupVerified: false }],
  ['xstocks_sell', { ticker: 'AAPL', amountWrapped: '1', walletAddress: PROBE_WALLET, backupVerified: false }],
  ['xstocks_basket_buy', { basket: 'bigtech', amountUsd: '30', walletAddress: PROBE_WALLET, backupVerified: false }],
  ['xstocks_basket_sell', { basket: 'yolo', walletAddress: PROBE_WALLET, backupVerified: false }],
] as const) {
  test(`${tool} without backupVerified returns the ritual (no network)`, async () => {
    const d = textOf(await client.callTool({ name: tool, arguments: args }));
    assert.equal(d.ok, false);
    assert.equal(d.blocked, 'backup ritual incomplete');
    assert.ok(Array.isArray(d.do_this_first) && d.do_this_first.length >= 4);
  });
}

test('fee config defaults to 25 bps to the treasury', () => {
  delete process.env.FOUR02_XSTOCKS_FEE_BPS;
  delete process.env.FOUR02_XSTOCKS_FEE_RECIPIENT;
  const cfg = loadXstocksFeeConfig();
  assert.equal(cfg.bps, 25);
  assert.equal(cfg.recipient, DEFAULT_FEE_RECIPIENT);
});

test('fee config honors env overrides and rejects garbage', () => {
  process.env.FOUR02_XSTOCKS_FEE_BPS = '50';
  process.env.FOUR02_XSTOCKS_FEE_RECIPIENT = '0xaA4E163dA1545F6967d284C0C5CFA469C644eD23';
  const cfg = loadXstocksFeeConfig();
  assert.equal(cfg.bps, 50);
  assert.equal(cfg.recipient, getAddress('0xaA4E163dA1545F6967d284C0C5CFA469C644eD23'));
  process.env.FOUR02_XSTOCKS_FEE_BPS = '1001';
  assert.throws(() => loadXstocksFeeConfig(), /0-1000/);
  process.env.FOUR02_XSTOCKS_FEE_BPS = 'abc';
  assert.throws(() => loadXstocksFeeConfig(), /0-1000/);
  delete process.env.FOUR02_XSTOCKS_FEE_BPS;
  delete process.env.FOUR02_XSTOCKS_FEE_RECIPIENT;
});

test('splitEqualWeight splits evenly, dust to the first ticker', () => {
  // $100 (6dp) across 3 -> 33.333334 / 33.333333 / 33.333333
  assert.deepEqual(splitEqualWeight(100_000_000n, 3), [33_333_334n, 33_333_333n, 33_333_333n]);
  // $30 across 5 -> $6 each, no dust
  assert.deepEqual(splitEqualWeight(30_000_000n, 5), [
    6_000_000n, 6_000_000n, 6_000_000n, 6_000_000n, 6_000_000n,
  ]);
  const parts = splitEqualWeight(100_000_000n, 9);
  assert.equal(parts.length, 9);
  assert.equal(parts.reduce((a, b) => a + b, 0n), 100_000_000n);
  assert.throws(() => splitEqualWeight(2n, 5), /too small/);
});

test('wallet_create returns a fresh address + private key', async () => {
  const d = textOf(await client.callTool({ name: 'wallet_create', arguments: {} }));
  assert.equal(d.ok, true);
  assert.ok(isAddress(d.address));
  assert.match(d.privateKey, /^0x[0-9a-fA-F]{64}$/);
  assert.equal(d.chainId, 57073);
});

test('wallet_verify_backup round trip: match and mismatch', async () => {
  const created = textOf(await client.callTool({ name: 'wallet_create', arguments: {} }));
  const ok = textOf(
    await client.callTool({
      name: 'wallet_verify_backup',
      arguments: { privateKey: created.privateKey, expectedAddress: created.address },
    }),
  );
  assert.equal(ok.matches, true);

  const other = textOf(await client.callTool({ name: 'wallet_create', arguments: {} }));
  const bad = textOf(
    await client.callTool({
      name: 'wallet_verify_backup',
      arguments: { privateKey: other.privateKey, expectedAddress: created.address },
    }),
  );
  assert.equal(bad.matches, false);

  const malformed = textOf(
    await client.callTool({
      name: 'wallet_verify_backup',
      arguments: { privateKey: 'not-a-key', expectedAddress: created.address },
    }),
  );
  assert.equal(malformed.ok, false);
});

test('venue constants intact: 9 pools, baskets reference real tickers', () => {
  assert.equal(XSTOCK_POOLS.length, 9);
  const tickers = new Set(XSTOCK_POOLS.map((p) => p.ticker));
  for (const [name, b] of Object.entries(XSTOCK_BASKETS)) {
    assert.ok(b.tickers.length > 0, `${name} is empty`);
    for (const t of b.tickers) assert.ok(tickers.has(t), `${name} references unknown ticker ${t}`);
  }
});
