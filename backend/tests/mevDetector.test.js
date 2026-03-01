/**
 * Unit tests for MEV Sandwich Detector
 */
const { isSwapTransaction, detectSandwichSafe, SWAP_SELECTORS, extractSwapPair, extractSwapDirection, detectSandwich } = require('../src/mevDetector');

// Shared mock provider
const mockProvider = {
  getBlockNumber: jest.fn(),
  getTransaction: jest.fn(),
  getBlock: jest.fn(),
};

const SWAP_SELECTOR = '0x38ed1739'; // swapExactTokensForTokens

const SWAP_EVENT_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

function makeTx(overrides = {}) {
  return {
    hash: '0x' + 'a'.repeat(64),
    from: '0x' + '1'.repeat(40),
    to: '0x' + '2'.repeat(40),
    blockNumber: 100,
    transactionIndex: 5,
    data: SWAP_SELECTOR + '0'.repeat(200),
    ...overrides,
  };
}

function makeReceipt(overrides = {}) {
  return { logs: [], ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isSwapTransaction', () => {
  test('returns true for known swap selectors', () => {
    for (const selector of SWAP_SELECTORS) {
      expect(isSwapTransaction({ data: selector + '0'.repeat(64) })).toBe(true);
    }
  });

  test('returns false for non-swap selector', () => {
    expect(isSwapTransaction({ data: '0xdeadbeef' + '0'.repeat(64) })).toBe(false);
  });

  test('returns false for null/empty tx', () => {
    expect(isSwapTransaction(null)).toBe(false);
    expect(isSwapTransaction({ data: '0x' })).toBe(false);
    expect(isSwapTransaction({ data: null })).toBe(false);
  });
});

describe('extractSwapPair', () => {
  test('returns null for null receipt', () => {
    expect(extractSwapPair(null)).toBeNull();
    expect(extractSwapPair({ logs: [] })).toBeNull();
  });

  test('extracts pair address from swap log', () => {
    const receipt = {
      logs: [{
        address: '0x' + 'c'.repeat(40),
        topics: [SWAP_EVENT_TOPIC],
        data: '0x' + '0'.repeat(256),
      }],
    };
    expect(extractSwapPair(receipt)).toBe('0x' + 'c'.repeat(40));
  });
});

describe('extractSwapDirection', () => {
  test('returns null for null receipt', () => {
    expect(extractSwapDirection(null)).toBeNull();
  });

  test('returns token0in when amount0In > 0', () => {
    // amount0In=1, amount1In=0, amount0Out=0, amount1Out=1
    const raw = '0'.repeat(63) + '1' + '0'.repeat(192);
    const receipt = {
      logs: [{
        topics: [SWAP_EVENT_TOPIC],
        data: '0x' + raw,
      }],
    };
    expect(extractSwapDirection(receipt)).toBe('token0in');
  });
});

describe('detectSandwichSafe', () => {
  test('returns null when provider getBlock fails', async () => {
    mockProvider.getBlock.mockRejectedValue(new Error('block fetch fail'));
    const result = await detectSandwichSafe(mockProvider, makeTx(), makeReceipt());
    expect(result).toBeNull();
  });

  test('returns isSuspicious=false when block has no other swap txs', async () => {
    mockProvider.getBlock.mockResolvedValue({
      transactions: [
        { hash: '0x' + 'a'.repeat(64), transactionIndex: 5, from: '0x' + '1'.repeat(40), data: SWAP_SELECTOR + '0'.repeat(64) },
      ],
    });
    const tx = makeTx();
    const result = await detectSandwichSafe(mockProvider, tx, makeReceipt());
    expect(result).not.toBeNull();
    expect(result.isSuspicious).toBe(false);
  });

  test('returns null for non-swap tx (no MEV risk)', async () => {
    mockProvider.getBlock.mockResolvedValue({ transactions: [] });
    const tx = makeTx({ data: '0x' });
    const result = await detectSandwichSafe(mockProvider, tx, makeReceipt());
    // non-swap tx returns null (no MEV risk)
    expect(result).toBeNull();
  });
});
