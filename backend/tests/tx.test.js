/**
 * Unit tests for TxTracer backend
 * index.js uses: const { ethers } = require('ethers')
 * So we must mock ethers.JsonRpcProvider inside the ethers namespace object.
 */

const request = require('supertest');
const actualEthers = jest.requireActual('ethers');

// Shared mock provider
const mockProvider = {
  getBlockNumber: jest.fn(),
  getTransaction: jest.fn(),
  getTransactionReceipt: jest.fn(),
  getBlock: jest.fn(),
  call: jest.fn(),
};

const MockJsonRpcProvider = jest.fn(() => mockProvider);

// Mock contract instance for ERC-20 calls
const mockContractInstance = {
  symbol: jest.fn().mockResolvedValue('USDT'),
  decimals: jest.fn().mockResolvedValue(18),
};

// Mock ethers: keep everything real EXCEPT ethers.JsonRpcProvider and ethers.Contract
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const MockJRP = jest.fn(() => mockProvider);
  const MockContract = jest.fn(() => mockContractInstance);
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: MockJRP,
      Contract: MockContract,
    },
  };
});

// Grab the mocked JsonRpcProvider reference
const { ethers: mockedEthers } = require('ethers');
const VALID_TX_HASH = '0x' + 'a'.repeat(64);

// Load app after mock is configured
const { app, parseTokenTransfers, tokenCache } = require('../src/index');

// Base tx object
function makeTx(overrides = {}) {
  return {
    from: '0xFromAddress',
    to: '0xToAddress',
    value: 1000000000000000000n, // 1 BNB
    gasLimit: 21000n,
    gasPrice: 5000000000n, // 5 Gwei
    data: '0x',
    nonce: 0,
    blockNumber: 999,
    ...overrides,
  };
}

function makeReceipt(status = 1, gasUsed = 21000n, overrides = {}) {
  return {
    status,
    blockNumber: 999,
    blockHash: '0x' + 'b'.repeat(64),
    gasUsed,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProvider.getBlockNumber.mockResolvedValue(1000);
  mockProvider.getTransaction.mockResolvedValue(null);
  mockProvider.getTransactionReceipt.mockResolvedValue(null);
  mockProvider.getBlock.mockResolvedValue({ timestamp: 1700000000 });
  mockProvider.call.mockResolvedValue('0x');
  mockedEthers.JsonRpcProvider.mockReturnValue(mockProvider);
});

// ─── txHash format validation ─────────────────────────────────────────────────

describe('txHash format validation', () => {
  test('valid hash (64 hex chars after 0x) → non-400', async () => {
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.status).not.toBe(400);
  });

  test('missing 0x prefix → 400', async () => {
    const res = await request(app).get('/api/v1/tx/' + 'a'.repeat(64));
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_TX_HASH');
  });

  test('too short hash → 400', async () => {
    const res = await request(app).get('/api/v1/tx/0xabc123');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('too long hash → 400', async () => {
    const res = await request(app).get('/api/v1/tx/0x' + 'a'.repeat(65));
    expect(res.status).toBe(400);
  });

  test('invalid hex chars → 400', async () => {
    const res = await request(app).get('/api/v1/tx/0x' + 'z'.repeat(64));
    expect(res.status).toBe(400);
  });

  test('400 response has correct structure', async () => {
    const res = await request(app).get('/api/v1/tx/0xshort');
    expect(res.body).toMatchObject({ success: false, error: { code: 'INVALID_TX_HASH' } });
    expect(typeof res.body.error.message).toBe('string');
  });
});

// ─── Not Found ────────────────────────────────────────────────────────────────

describe('Not Found', () => {
  test('tx === null → 404 with TX_NOT_FOUND', async () => {
    // getTransaction returns null (default)
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TX_NOT_FOUND');
    expect(res.body.error.message).toContain('未找到');
  });
});

// ─── PENDING ──────────────────────────────────────────────────────────────────

describe('PENDING status', () => {
  test('receipt === null → PENDING', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    // getTransactionReceipt stays null (default)
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.status).toBe('PENDING');
    expect(data.txHash).toBe(VALID_TX_HASH);
    expect(data.valueSymbol).toBe('BNB');
    expect(data.gasPriceUnit).toBe('Gwei');
    expect(data.explorerUrl).toContain('bscscan.com');
    expect(data).toHaveProperty('gasLimit');
    expect(data).toHaveProperty('nonce');
    expect(data).toHaveProperty('inputData');
  });
});

// ─── SUCCESS ──────────────────────────────────────────────────────────────────

describe('SUCCESS status', () => {
  test('receipt.status === 1 → SUCCESS with full fields', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.status).toBe('SUCCESS');
    expect(data).toHaveProperty('blockNumber');
    expect(data).toHaveProperty('gasUsed');
    expect(data).toHaveProperty('gasFee');
    expect(data).toHaveProperty('gasFeeSymbol', 'BNB');
    expect(data).toHaveProperty('confirmations');
    expect(data).toHaveProperty('timestamp');
    expect(data.explorerUrl).toContain('bscscan.com');
  });

  test('block === null → timestamp is null', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    mockProvider.getBlock.mockResolvedValue(null);
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.timestamp).toBeNull();
  });
});

// ─── FAILED ───────────────────────────────────────────────────────────────────

describe('FAILED - OUT_OF_GAS', () => {
  test('gasUsed >= gasLimit → OUT_OF_GAS', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 21000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 21000n));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(res.body.data.status).toBe('FAILED');
    expect(fi.errorCategory).toBe('OUT_OF_GAS');
    expect(fi.errorCategoryDesc).toBe('Gas 耗尽');
    expect(fi.revertReason).toBeNull();
    expect(fi.suggestion).toContain('gasLimit');
  });
});

describe('FAILED - CONTRACT_REVERT', () => {
  function revertDataFor(str) {
    const abiCoder = actualEthers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(['string'], [str]);
    return '0x08c379a0' + encoded.slice(2);
  }

  const revertCases = [
    ['insufficient balance', '余额'],
    ['not owner', '权限'],
    ['allowance not enough', '授权'],
    ['deadline expired', '过期'],
    ['slippage exceeded', '滑点'],
    ['contract paused', '暂停'],
    ['invalid amount zero', '零'],
    ['some unknown error xyz', '合约回滚原因'],
  ];

  test.each(revertCases)('reason "%s" → suggestion contains "%s"', async (reason, expectedStr) => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue({ data: revertDataFor(reason) });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(fi.errorCategory).toBe('CONTRACT_REVERT');
    expect(fi.revertReason).toBe(reason);
    expect(fi.suggestion).toContain(expectedStr);
  });

  test('malformed revert data → decode failure fallback', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue({ data: '0x08c379a0deadbeef' });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(fi.errorCategory).toBe('CONTRACT_REVERT');
    expect(fi.revertReason).toBe('无法解码回滚原因');
  });
});

describe('FAILED - PANIC', () => {
  function panicDataFor(code) {
    const abiCoder = actualEthers.AbiCoder.defaultAbiCoder();
    const encoded = abiCoder.encode(['uint256'], [code]);
    return '0x4e487b71' + encoded.slice(2);
  }

  const panicCases = [
    [0, '断言失败', '断言'],
    [1, '算术溢出', '溢出'],
    [17, '数组越界', '越界'],
    [18, '除以零', '零'],
    [34, '空数组弹出', '数组'],
    [65, '内存分配失败', '内存'],
  ];

  test.each(panicCases)('panic code %i → reason contains "%s"', async (code, expectedReason, _) => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue({ data: panicDataFor(code) });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(fi.errorCategory).toBe('PANIC');
    expect(fi.revertReason).toContain(expectedReason);
  });

  test('unknown panic code (999) → fallback description', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue({ data: panicDataFor(999) });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(fi.errorCategory).toBe('PANIC');
    expect(fi.revertReason).toContain('999');
    expect(fi.suggestion).toContain('Panic');
  });

  test('malformed panic data → decode failure fallback', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue({ data: '0x4e487b71deadbeef' });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(fi.errorCategory).toBe('PANIC');
    expect(fi.revertReason).toBe('无法解码 Panic 错误码');
  });
});

describe('FAILED - UNKNOWN', () => {
  test('call resolves with 0x → UNKNOWN, no revert data', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockResolvedValue('0x');
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(fi.errorCategory).toBe('UNKNOWN');
    expect(fi.revertReason).toBe('无法获取回滚数据');
  });

  test('error with non-empty revert data', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue({ data: '0xdeadbeef' });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(fi.errorCategory).toBe('UNKNOWN');
    expect(fi.revertReasonRaw).toBe('0xdeadbeef');
    expect(fi.revertReason).toBe('0xdeadbeef');
  });

  test('error.error.data path', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue({ error: { data: '0xcafebabe' } });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.failureInfo.errorCategory).toBe('UNKNOWN');
    expect(res.body.data.failureInfo.revertReasonRaw).toBe('0xcafebabe');
  });

  test('error.message hex extraction', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue({ message: 'execution reverted: 0xabcdef12' });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.failureInfo.errorCategory).toBe('UNKNOWN');
  });

  test('plain Error object → no revert data', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n));
    mockProvider.call.mockRejectedValue(new Error('just an error'));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const fi = res.body.data.failureInfo;
    expect(fi.errorCategory).toBe('UNKNOWN');
    expect(fi.revertReason).toBe('无法获取回滚数据');
  });
});

// ─── Server error handling ────────────────────────────────────────────────────

describe('Server error handling', () => {
  test('getTransaction throws → 500', async () => {
    mockProvider.getTransaction.mockRejectedValue(new Error('network error'));
    mockProvider.getTransactionReceipt.mockRejectedValue(new Error('network error'));
    mockProvider.getBlockNumber.mockRejectedValue(new Error('network error'));
    // Both primary and fallback use same mockProvider, so fallback will also fail on getBlockNumber
    // Actually: primary fails → fallback new JsonRpcProvider → returns mockProvider → getBlockNumber throws in getProvider... wait no
    // getProvider catches getBlockNumber failure → returns fallback provider (mockProvider again)
    // Then Promise.all: getTransaction rejects → catch → 500
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── datetime field ───────────────────────────────────────────────────────────

describe('datetime field', () => {
  const DATETIME_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

  test('SUCCESS response contains datetime in YYYY-MM-DD HH:mm:ss format', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    mockProvider.getBlock.mockResolvedValue({ timestamp: 1700000000 });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data).toHaveProperty('datetime');
    expect(res.body.data.datetime).toMatch(DATETIME_REGEX);
  });

  test('FAILED response contains datetime field', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 21000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 21000n));
    mockProvider.getBlock.mockResolvedValue({ timestamp: 1700000000 });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data).toHaveProperty('datetime');
    expect(res.body.data.datetime).toMatch(DATETIME_REGEX);
  });

  test('block === null → datetime is null', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    mockProvider.getBlock.mockResolvedValue(null);
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.datetime).toBeNull();
  });

  test('timestamp=0 → datetime is 1970-01-01 08:00:00 (UTC+8)', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    mockProvider.getBlock.mockResolvedValue({ timestamp: 0 });
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.datetime).toBe('1970-01-01 08:00:00');
  });
});

// ─── Health endpoint ──────────────────────────────────────────────────────────

describe('Health endpoint', () => {
  test('GET /health → { status: ok }', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('V2 API - input validation', () => {
  test('invalid txHash -> 400', async () => { const res = await request(app).get('/api/v2/tx/0xinvalid?chain=bsc'); expect(res.status).toBe(400); expect(res.body.error.code).toBe('INVALID_TX_HASH'); });
  test('unsupported chain -> 400', async () => { const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=sol`); expect(res.status).toBe(400); expect(res.body.error.code).toBe('UNSUPPORTED_CHAIN'); });
});
describe('V2 API - BSC', () => {
  test('not found -> 404', async () => { const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=bsc`); expect(res.status).toBe(404); expect(res.body.error.code).toBe('TX_NOT_FOUND'); });
  test('pending -> PENDING', async () => { mockProvider.getTransaction.mockResolvedValue(makeTx()); const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=bsc`); expect(res.body.data.status).toBe('PENDING'); expect(res.body.data.chain).toBe('bsc'); expect(res.body.data).not.toHaveProperty('txType'); });
  test('success -> SUCCESS', async () => { mockProvider.getTransaction.mockResolvedValue(makeTx()); mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1)); const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=bsc`); expect(res.body.data.status).toBe('SUCCESS'); expect(res.body.data.value.symbol).toBe('BNB'); });
  test('default is bsc', async () => { mockProvider.getTransaction.mockResolvedValue(makeTx()); const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}`); expect(res.body.data.chain).toBe('bsc'); });
  test('error -> 500', async () => { mockProvider.getTransaction.mockRejectedValue(new Error('e')); mockProvider.getTransactionReceipt.mockRejectedValue(new Error('e')); mockProvider.getBlockNumber.mockRejectedValue(new Error('e')); const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=bsc`); expect(res.status).toBe(500); expect(res.body.error.code).toBe('INTERNAL_ERROR'); });
});
describe('V2 API - ETH', () => {
  test('legacy type=0', async () => { mockProvider.getTransaction.mockResolvedValue(makeTx({ type: 0 })); mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1)); const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=eth`); expect(res.body.data.chain).toBe('eth'); expect(res.body.data.txType).toBe(0); expect(res.body.data.baseFee).toBeNull(); expect(res.body.data.explorerUrl).toContain('etherscan.io'); expect(res.body.data.value.symbol).toBe('ETH'); });
  test('EIP-1559 type=2', async () => { mockProvider.getTransaction.mockResolvedValue(makeTx({ type: 2, maxPriorityFeePerGas: 1500000000n })); mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1)); mockProvider.getBlock.mockResolvedValue({ timestamp: 1700000000, baseFeePerGas: 15000000000n }); const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=eth`); expect(res.body.data.txType).toBe(2); expect(res.body.data.baseFee).toBeCloseTo(15, 1); expect(res.body.data.maxPriorityFee).toBeCloseTo(1.5, 1); });
  test('EIP-1559 null block', async () => { mockProvider.getTransaction.mockResolvedValue(makeTx({ type: 2, maxPriorityFeePerGas: 1000000000n })); mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1)); mockProvider.getBlock.mockResolvedValue(null); const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=eth`); expect(res.body.data.txType).toBe(2); expect(res.body.data.baseFee).toBeNull(); });
  test('eth pending', async () => { mockProvider.getTransaction.mockResolvedValue(makeTx({ type: 2 })); const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=eth`); expect(res.body.data.status).toBe('PENDING'); expect(res.body.data.txType).toBe(2); expect(res.body.data.baseFee).toBeNull(); });
});

// ─── ERC-20 Token Transfer Parsing ───────────────────────────────────────────

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function makeTransferLog(contractAddress, from, to, valueBigInt) {
  const padAddress = (addr) => '0x' + '0'.repeat(24) + addr.replace('0x', '').toLowerCase();
  return {
    address: contractAddress,
    topics: [ERC20_TRANSFER_TOPIC, padAddress(from), padAddress(to)],
    data: '0x' + valueBigInt.toString(16).padStart(64, '0'),
  };
}

describe('parseTokenTransfers', () => {
  beforeEach(() => {
    tokenCache.clear();
    mockContractInstance.symbol.mockResolvedValue('USDT');
    mockContractInstance.decimals.mockResolvedValue(18);
  });

  test('empty logs returns []', async () => {
    const result = await parseTokenTransfers(mockProvider, []);
    expect(result).toEqual([]);
  });

  test('null logs returns []', async () => {
    const result = await parseTokenTransfers(mockProvider, null);
    expect(result).toEqual([]);
  });

  test('no transfer logs returns []', async () => {
    const result = await parseTokenTransfers(mockProvider, [{ topics: ['0xdeadbeef'], data: '0x00' }]);
    expect(result).toEqual([]);
  });

  test('parses single USDT transfer', async () => {
    const log = makeTransferLog(
      '0x55d398326f99059ff775485246999027b3197955',
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      BigInt('1000000000000000000'), // 1 USDT
    );
    const result = await parseTokenTransfers(mockProvider, [log]);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('USDT');
    expect(result[0].decimals).toBe(18);
    expect(result[0].value).toBe('1.00');
    expect(result[0].valueRaw).toBe('1000000000000000000');
  });

  test('caches token info', async () => {
    const log = makeTransferLog(
      '0x55d398326f99059ff775485246999027b3197955',
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      BigInt('500000000000000000'),
    );
    await parseTokenTransfers(mockProvider, [log]);
    await parseTokenTransfers(mockProvider, [log]);
    // symbol() should be called only once (cached)
    expect(mockContractInstance.symbol).toHaveBeenCalledTimes(1);
  });

  test('fallback to UNKNOWN on contract error', async () => {
    mockContractInstance.symbol.mockRejectedValue(new Error('not a token'));
    const log = makeTransferLog(
      '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      BigInt('1000000000000000000'),
    );
    const result = await parseTokenTransfers(mockProvider, [log]);
    expect(result[0].symbol).toBe('UNKNOWN');
  });
});

describe('ERC-20 transfers in v1 API response', () => {
  beforeEach(() => {
    tokenCache.clear();
    mockContractInstance.symbol.mockResolvedValue('USDT');
    mockContractInstance.decimals.mockResolvedValue(18);
  });

  test('SUCCESS with token transfer includes tokenTransfers', async () => {
    const log = makeTransferLog(
      '0x55d398326f99059ff775485246999027b3197955',
      '0x1111111111111111111111111111111111111111',
      '0x2222222222222222222222222222222222222222',
      BigInt('1000000000000000000'),
    );
    const receipt = makeReceipt(1, 21000n);
    receipt.logs = [log];
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(receipt);
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.tokenTransfers).toHaveLength(1);
    expect(res.body.data.tokenTransfers[0].symbol).toBe('USDT');
  });

  test('SUCCESS with no logs has empty tokenTransfers', async () => {
    const receipt = makeReceipt(1, 21000n);
    receipt.logs = [];
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(receipt);
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.tokenTransfers).toEqual([]);
  });
});

// ─── DEX Swap Parsing ─────────────────────────────────────────────────────────
const { parseSwapEvents } = require('../src/index');

const SWAP_V2_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37ef4abab29e4e0fee1d3b3bee';
const SWAP_V3_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

const { ethers: realEthers } = jest.requireActual('ethers');

function encodeV2SwapData(a0In, a1In, a0Out, a1Out) {
  const abiCoder = realEthers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(['uint256', 'uint256', 'uint256', 'uint256'], [a0In, a1In, a0Out, a1Out]);
}

function encodeV3SwapData(amount0, amount1) {
  const abiCoder = realEthers.AbiCoder.defaultAbiCoder();
  return abiCoder.encode(['int256', 'int256', 'uint160', 'uint128', 'int24'], [amount0, amount1, 0n, 0n, 0]);
}

describe('parseSwapEvents', () => {
  const TOKEN0 = '0x' + '1'.repeat(40);
  const TOKEN1 = '0x' + '2'.repeat(40);
  const POOL = '0x' + '3'.repeat(40);

  beforeEach(() => {
    tokenCache.clear();
    mockContractInstance.symbol.mockResolvedValue('USDT');
    mockContractInstance.decimals.mockResolvedValue(18);
  });

  const makeSwapReceipt = (topic, data) => ({
    logs: [{
      address: POOL,
      topics: [topic, '0x' + '0'.repeat(64), '0x' + '0'.repeat(64)],
      data,
    }],
  });

  test('no logs returns []', async () => {
    const result = await parseSwapEvents(mockProvider, { logs: [] });
    expect(result).toEqual([]);
  });

  test('V2 swap - token0 in', async () => {
    // Mock pool contract for token0/token1
    const poolMock = { token0: jest.fn().mockResolvedValue(TOKEN0), token1: jest.fn().mockResolvedValue(TOKEN1) };
    const { ethers: mockedEthers2 } = require('ethers');
    mockedEthers2.Contract = jest.fn((addr) => {
      if (addr === POOL) return poolMock;
      return mockContractInstance;
    });
    const data = encodeV2SwapData(1000n, 0n, 0n, 2000n);
    const receipt = makeSwapReceipt(SWAP_V2_TOPIC, data);
    const result = await parseSwapEvents(mockProvider, receipt);
    expect(result).toHaveLength(1);
    expect(result[0].dex).toContain('V2');
    expect(result[0].tokenIn.symbol).toBe('USDT');
    expect(result[0].tokenOut.symbol).toBe('USDT');
  });

  test('V3 swap - amount0 positive', async () => {
    const poolMock = { token0: jest.fn().mockResolvedValue(TOKEN0), token1: jest.fn().mockResolvedValue(TOKEN1) };
    const { ethers: mockedEthers2 } = require('ethers');
    mockedEthers2.Contract = jest.fn((addr) => {
      if (addr === POOL) return poolMock;
      return mockContractInstance;
    });
    const data = encodeV3SwapData(1000n, -2000n);
    const receipt = makeSwapReceipt(SWAP_V3_TOPIC, data);
    const result = await parseSwapEvents(mockProvider, receipt);
    expect(result).toHaveLength(1);
    expect(result[0].dex).toBe('Uniswap V3');
  });
});
