import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import {
  handleWalletCreate,
  handleWalletVerifyBackup,
} from '../src/wallet.js';

function parseJsonResult(result: { content: { type: string; text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

test('handleWalletCreate returns valid address and private key', async () => {
  const result = await handleWalletCreate();
  const body = parseJsonResult(result);

  assert.equal(body.ok, true);
  assert.match(body.address, /^0x[0-9a-fA-F]{40}$/);
  assert.match(body.privateKey, /^0x[0-9a-fA-F]{64}$/);
  assert.equal(body.chainId, 57073);
  assert.ok(Array.isArray(body.backup_steps));
  assert.ok(body.warning.includes('no recovery'));
});

test('handleWalletCreate returns different keys on each call', async () => {
  const r1 = parseJsonResult(await handleWalletCreate());
  const r2 = parseJsonResult(await handleWalletCreate());
  assert.notEqual(r1.privateKey, r2.privateKey);
  assert.notEqual(r1.address, r2.address);
});

test('handleWalletVerifyBackup: correct key + correct address -> matches:true', async () => {
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;

  const result = await handleWalletVerifyBackup({
    privateKey: key,
    expectedAddress: address,
  });
  const body = parseJsonResult(result);

  assert.equal(body.ok, true);
  assert.equal(body.matches, true);
  assert.match(body.next, /safe to fund/);
});

test('handleWalletVerifyBackup: correct key + WRONG address -> matches:false', async () => {
  const key = generatePrivateKey();
  const wrongAddress = '0x0000000000000000000000000000000000000001';

  const result = await handleWalletVerifyBackup({
    privateKey: key,
    expectedAddress: wrongAddress,
  });
  const body = parseJsonResult(result);

  assert.equal(body.ok, true);
  assert.equal(body.matches, false);
  assert.match(body.next, /MISMATCH/);
});

test('handleWalletVerifyBackup: invalid private key format -> error', async () => {
  const result = await handleWalletVerifyBackup({
    privateKey: 'not-a-key',
    expectedAddress: '0x0000000000000000000000000000000000000001',
  });
  const body = parseJsonResult(result);

  assert.equal(body.ok, false);
  assert.equal(body.error, 'invalid_private_key');
});

test('handleWalletVerifyBackup: missing 0x prefix -> error', async () => {
  const key = generatePrivateKey().slice(2); // Remove 0x prefix
  const result = await handleWalletVerifyBackup({
    privateKey: key,
    expectedAddress: '0x0000000000000000000000000000000000000001',
  });
  const body = parseJsonResult(result);

  assert.equal(body.ok, false);
  assert.equal(body.error, 'invalid_private_key');
});

test('handleWalletVerifyBackup: invalid address -> error', async () => {
  const key = generatePrivateKey();
  const result = await handleWalletVerifyBackup({
    privateKey: key,
    expectedAddress: 'not-an-address',
  });
  const body = parseJsonResult(result);

  assert.equal(body.ok, false);
  assert.equal(body.error, 'invalid_expected_address');
});

test('handleWalletVerifyBackup: full backup ritual round-trip', async () => {
  // 1. Create wallet
  const created = parseJsonResult(await handleWalletCreate());
  assert.equal(created.ok, true);

  // 2. Verify with the same key (simulated backup)
  const verified = parseJsonResult(
    await handleWalletVerifyBackup({
      privateKey: created.privateKey,
      expectedAddress: created.address,
    }),
  );
  assert.equal(verified.matches, true);

  // 3. Verify with a different key (simulated bad backup)
  const wrongKey = generatePrivateKey();
  const mismatched = parseJsonResult(
    await handleWalletVerifyBackup({
      privateKey: wrongKey,
      expectedAddress: created.address,
    }),
  );
  assert.equal(mismatched.matches, false);
});