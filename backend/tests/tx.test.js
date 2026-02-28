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

// Mock ethers: keep everything real EXCEPT ethers.JsonRpcProvider
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const MockJRP = jest.fn(() => mockProvider);
  return {
    ...actual,
    ethers: {
      ...actual.ethers,
      JsonRpcProvider: MockJRP,
    },
  };
});

// Grab the mocked JsonRpcProvider reference
const { ethers: mockedEthers } = require('ethers');
const VALID_TX_HASH = '0x' + 'a'.repeat(64);

// Load app after mock is configured
const { app } = require('../src/index');

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
    expect(res.body.code).toBe(400);
    expect(res.body.data).toBeNull();
  });

  test('too short hash → 400', async () => {
    const res = await request(app).get('/api/v1/tx/0xabc123');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(400);
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
    expect(res.body).toMatchObject({ code: 400, data: null });
    expect(typeof res.body.message).toBe('string');
  });
});

// ─── Not Found ────────────────────────────────────────────────────────────────

describe('Not Found', () => {
  test('tx === null → code 404 in body', async () => {
    // getTransaction returns null (default)
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(404);
    expect(res.body.data).toBeNull();
    expect(res.body.message).toContain('未找到');
  });
});

// ─── PENDING ──────────────────────────────────────────────────────────────────

describe('PENDING status', () => {
  test('receipt === null → PENDING', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    // getTransactionReceipt stays null (default)
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.code).toBe(200);
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
    expect(res.body.code).toBe(200);
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
    expect(res.body.code).toBe(500);
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

// ─── v2 API - ISSUE-002 new response structure ────────────────────────────────

describe('v2 API - new response structure (ISSUE-002)', () => {
  test('defaults to bsc when no chain param', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.requestId).toBeDefined();
    const data = res.body.data;
    expect(data.chain).toBe('bsc');
    expect(data.chainName).toBe('BNB Smart Chain');
    expect(data.value.symbol).toBe('BNB');
    expect(data.value.decimals).toBe(18);
  });

  test('chain=bsc → BSC chain info with structured value', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=bsc`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.chain).toBe('bsc');
    expect(data.value).toHaveProperty('amount');
    expect(data.value).toHaveProperty('symbol');
    expect(data.value).toHaveProperty('raw');
    expect(data.value).toHaveProperty('decimals');
  });

  test('chain=base → Base chain info', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=base`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.chain).toBe('base');
    expect(data.chainName).toBe('Base');
    expect(data.value.symbol).toBe('ETH');
    expect(data.value.decimals).toBe(18);
  });

  test('PENDING tx → status PENDING, datetime null', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    // receipt stays null (PENDING)
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=base`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.status).toBe('PENDING');
    expect(data.datetime).toBeNull();
  });

  test('FAILED tx → status FAILED', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 21000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 21000n));
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=base`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.status).toBe('FAILED');
    expect(data.chain).toBe('base');
  });

  test('unsupported chain → 400 with UNSUPPORTED_CHAIN error code', async () => {
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=ethereum`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNSUPPORTED_CHAIN');
    expect(res.body.requestId).toBeDefined();
  });

  test('v2 response includes chain, chainName, value, datetime fields', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=base`);
    const data = res.body.data;
    expect(data).toHaveProperty('chain');
    expect(data).toHaveProperty('chainName');
    expect(data).toHaveProperty('value');
    expect(data).toHaveProperty('datetime');
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('txHash');
  });

  test('v1 API still works and returns bsc explorer url (backward compat)', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.code).toBe(200);
    expect(res.body.data.explorerUrl).toContain('bscscan.com');
    // v1 does not return chain field (backward compat)
    expect(res.body.data.chain).toBeUndefined();
  });

  test('tx not found → 404 with TX_NOT_FOUND error code', async () => {
    // getTransaction returns null (default)
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}?chain=base`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TX_NOT_FOUND');
  });

  test('invalid hash → 400 with INVALID_TX_HASH error code', async () => {
    const res = await request(app).get('/api/v2/tx/invalid-hash');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_TX_HASH');
  });

  test('datetime object has utc, local, timezone, timestamp fields', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    const res = await request(app).get(`/api/v2/tx/${VALID_TX_HASH}`);
    const dt = res.body.data.datetime;
    expect(dt).toHaveProperty('utc');
    expect(dt).toHaveProperty('local');
    expect(dt).toHaveProperty('timezone', 'Asia/Shanghai');
    expect(dt).toHaveProperty('timestamp');
  });
});
