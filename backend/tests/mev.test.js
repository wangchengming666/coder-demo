/**
 * Unit tests for MEV Sandwich Attack Detection (ISSUE-013)
 */

const {
  isSwapTransaction,
  detectSandwich,
  detectSandwichSafe,
  SWAP_SELECTORS,
  SWAP_EVENT_TOPIC,
  extractSwapPair,
  extractSwapDirection,
} = require('../src/mevDetector');

// ─── isSwapTransaction ────────────────────────────────────────────────────────

describe('isSwapTransaction', () => {
  test('swapExactTokensForTokens selector → true', () => {
    expect(isSwapTransaction({ data: '0x38ed1739deadbeef' })).toBe(true);
  });

  test('exactInputSingle (Uni V3) selector → true', () => {
    expect(isSwapTransaction({ data: '0x414bf389deadbeef' })).toBe(true);
  });

  test('non-swap selector → false', () => {
    expect(isSwapTransaction({ data: '0x12345678deadbeef' })).toBe(false);
  });

  test('empty data → false', () => {
    expect(isSwapTransaction({ data: '0x' })).toBe(false);
  });

  test('no data field → false', () => {
    expect(isSwapTransaction({})).toBe(false);
  });

  test('null tx → false', () => {
    expect(isSwapTransaction(null)).toBe(false);
  });

  test('case-insensitive selector matching', () => {
    expect(isSwapTransaction({ data: '0x38ED1739DEADBEEF' })).toBe(true);
  });
});

// ─── extractSwapPair ──────────────────────────────────────────────────────────

describe('extractSwapPair', () => {
  test('returns address from Swap event log', () => {
    const receipt = {
      logs: [
        { topics: [SWAP_EVENT_TOPIC], address: '0xPairAddress', data: '0x' },
      ],
    };
    expect(extractSwapPair(receipt)).toBe('0xpairaddress');
  });

  test('no matching topic → null', () => {
    const receipt = {
      logs: [{ topics: ['0xdeadbeef'], address: '0xSomething', data: '0x' }],
    };
    expect(extractSwapPair(receipt)).toBeNull();
  });

  test('empty logs → null', () => {
    expect(extractSwapPair({ logs: [] })).toBeNull();
  });

  test('null receipt → null', () => {
    expect(extractSwapPair(null)).toBeNull();
  });
});

// ─── extractSwapDirection ────────────────────────────────────────────────────

describe('extractSwapDirection', () => {
  function makeSwapLog(amount0In, amount1In, amount0Out, amount1Out) {
    const toHex = n => n.toString(16).padStart(64, '0');
    const data = '0x' + toHex(amount0In) + toHex(amount1In) + toHex(amount0Out) + toHex(amount1Out);
    return { topics: [SWAP_EVENT_TOPIC], address: '0xPair', data };
  }

  test('amount0In > 0 → token0in', () => {
    const receipt = { logs: [makeSwapLog(1000, 0, 0, 900)] };
    expect(extractSwapDirection(receipt)).toBe('token0in');
  });

  test('amount1In > 0 → token1in', () => {
    const receipt = { logs: [makeSwapLog(0, 1000, 900, 0)] };
    expect(extractSwapDirection(receipt)).toBe('token1in');
  });

  test('no Swap log → null', () => {
    expect(extractSwapDirection({ logs: [] })).toBeNull();
  });
});

// ─── detectSandwich ──────────────────────────────────────────────────────────

const SWAP_DATA = '0x38ed1739' + '00'.repeat(100); // swapExactTokensForTokens
const ROUTER = '0xRouterAddress';

function makeTx(hash, from, data = SWAP_DATA, to = ROUTER) {
  return { hash, from, to, data };
}

function makeReceipt(blockNumber, txHash, logs = []) {
  return { blockNumber, transactionHash: txHash, logs };
}

function makeBlock(txList) {
  return { transactions: txList };
}

describe('detectSandwich', () => {
  let provider;

  beforeEach(() => {
    provider = {
      getBlock: jest.fn(),
      getTransactionReceipt: jest.fn(),
    };
  });

  test('non-Swap tx → mevInfo: null', async () => {
    const tx = { hash: '0xTarget', from: '0xUser', to: ROUTER, data: '0x12345678' };
    const receipt = makeReceipt(100, '0xTarget');
    provider.getBlock.mockResolvedValue(makeBlock([]));
    const result = await detectSandwich(provider, tx, receipt);
    expect(result).toBeNull();
  });

  test('sandwich detected → isSuspicious true, attackType sandwich', async () => {
    const targetTx = makeTx('0xTarget', '0xUser');
    const frontTx = makeTx('0xFront', '0xAttacker');
    const backTx = makeTx('0xBack', '0xAttacker');
    const receipt = makeReceipt(100, '0xTarget');

    const block = makeBlock([frontTx, targetTx, backTx]);
    provider.getBlock.mockResolvedValue(block);

    const result = await detectSandwich(provider, targetTx, receipt);
    expect(result.isSuspicious).toBe(true);
    expect(result.attackType).toBe('sandwich');
    expect(result.frontRunTx).toBe('0xFront');
    expect(result.backRunTx).toBe('0xBack');
    expect(['high', 'medium']).toContain(result.confidence);
  });

  test('no front/back run → isSuspicious false', async () => {
    const targetTx = makeTx('0xTarget', '0xUser');
    // Non-swap tx (different router and different selector) - won't match
    const otherTx = { hash: '0xOther', from: '0xSomeoneElse', to: '0xDifferentRouter', data: '0x12345678' };
    const receipt = makeReceipt(100, '0xTarget');

    provider.getBlock.mockResolvedValue(makeBlock([otherTx, targetTx]));

    const result = await detectSandwich(provider, targetTx, receipt);
    expect(result.isSuspicious).toBe(false);
    expect(result.attackType).toBeNull();
  });

  test('front-run only → frontrun attack type', async () => {
    const targetTx = makeTx('0xTarget', '0xUser');
    const frontTx = makeTx('0xFront', '0xAttacker');
    const receipt = makeReceipt(100, '0xTarget');

    provider.getBlock.mockResolvedValue(makeBlock([frontTx, targetTx]));

    const result = await detectSandwich(provider, targetTx, receipt);
    expect(result.isSuspicious).toBe(true);
    expect(result.attackType).toBe('frontrun');
    expect(result.frontRunTx).toBe('0xFront');
    expect(result.backRunTx).toBeNull();
  });

  test('target not found in block → isSuspicious false', async () => {
    const targetTx = makeTx('0xTarget', '0xUser');
    const receipt = makeReceipt(100, '0xTarget');
    // Block doesn't include target
    provider.getBlock.mockResolvedValue(makeBlock([makeTx('0xOther', '0xSomeone')]));

    const result = await detectSandwich(provider, targetTx, receipt);
    expect(result.isSuspicious).toBe(false);
  });

  test('sandwich attacker not same as target sender → confidence high', async () => {
    const targetTx = makeTx('0xTarget', '0xUser');
    const frontTx = makeTx('0xFront', '0xAttacker');
    const backTx = makeTx('0xBack', '0xAttacker');
    const receipt = makeReceipt(100, '0xTarget');

    provider.getBlock.mockResolvedValue(makeBlock([frontTx, targetTx, backTx]));

    const result = await detectSandwich(provider, targetTx, receipt);
    expect(result.confidence).toBe('high');
  });

  test('non-swap tx in block skipped', async () => {
    const targetTx = makeTx('0xTarget', '0xUser');
    const nonSwap = { hash: '0xNonSwap', from: '0xAttacker', to: ROUTER, data: '0x12345678' };
    const backTx = makeTx('0xBack', '0xAttacker');
    const receipt = makeReceipt(100, '0xTarget');

    provider.getBlock.mockResolvedValue(makeBlock([nonSwap, targetTx, backTx]));

    const result = await detectSandwich(provider, targetTx, receipt);
    // nonSwap is not a swap, so no front-run from attacker; backTx alone is not enough
    expect(result.isSuspicious).toBe(false);
  });

  test('different router → not a candidate', async () => {
    const targetTx = makeTx('0xTarget', '0xUser', SWAP_DATA, '0xRouter1');
    const frontTx = makeTx('0xFront', '0xAttacker', SWAP_DATA, '0xRouter2');
    const backTx = makeTx('0xBack', '0xAttacker', SWAP_DATA, '0xRouter2');
    const receipt = makeReceipt(100, '0xTarget');

    provider.getBlock.mockResolvedValue(makeBlock([frontTx, targetTx, backTx]));

    const result = await detectSandwich(provider, targetTx, receipt);
    expect(result.isSuspicious).toBe(false);
  });
});

// ─── detectSandwichSafe ──────────────────────────────────────────────────────

describe('detectSandwichSafe', () => {
  test('returns null if provider throws (graceful degradation)', async () => {
    const provider = { getBlock: jest.fn().mockRejectedValue(new Error('RPC error')) };
    const tx = makeTx('0xTarget', '0xUser');
    const receipt = makeReceipt(100, '0xTarget');
    const result = await detectSandwichSafe(provider, tx, receipt);
    expect(result).toBeNull();
  });

  test('returns mevInfo normally when no error', async () => {
    const provider = { getBlock: jest.fn().mockResolvedValue(makeBlock([makeTx('0xTarget', '0xUser')])) };
    const tx = makeTx('0xTarget', '0xUser');
    const receipt = makeReceipt(100, '0xTarget');
    const result = await detectSandwichSafe(provider, tx, receipt);
    expect(result).not.toBeNull();
    expect(result.isSuspicious).toBe(false);
  });
});
