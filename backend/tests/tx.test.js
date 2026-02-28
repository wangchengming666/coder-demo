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

// Mock ethers: keep everything real EXCEPT ethers.JsonRpcProvider and ethers.Contract
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  const MockJRP = jest.fn(() => mockProvider);
  // mockContract will be set per test
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

// Grab the mocked references
const { ethers: mockedEthers } = require('ethers');

// Default mock contract instance (for ERC-20 symbol/decimals)
const mockContractInstance = {
  symbol: jest.fn(),
  decimals: jest.fn(),
};

const VALID_TX_HASH = '0x' + 'a'.repeat(64);
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// Load app after mock is configured
const { app, parseTokenTransfers, tokenCache, TOKEN_CACHE_TTL_MS } = require('../src/index');

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
    logs: [],
    ...overrides,
  };
}

/**
 * Build a synthetic ERC-20 Transfer log entry.
 */
function makeTransferLog(contractAddress, from, to, valueBigInt) {
  const padAddress = (addr) => '0x' + '0'.repeat(24) + addr.replace('0x', '').toLowerCase();
  return {
    address: contractAddress,
    topics: [
      ERC20_TRANSFER_TOPIC,
      padAddress(from),
      padAddress(to),
    ],
    data: '0x' + valueBigInt.toString(16).padStart(64, '0'),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  tokenCache.clear();
  mockProvider.getBlockNumber.mockResolvedValue(1000);
  mockProvider.getTransaction.mockResolvedValue(null);
  mockProvider.getTransactionReceipt.mockResolvedValue(null);
  mockProvider.getBlock.mockResolvedValue({ timestamp: 1700000000 });
  mockProvider.call.mockResolvedValue('0x');
  mockedEthers.JsonRpcProvider.mockReturnValue(mockProvider);
  // Default contract mock: USDT 18 decimals
  mockContractInstance.symbol.mockResolvedValue('USDT');
  mockContractInstance.decimals.mockResolvedValue(18);
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

// ─── requestId field ──────────────────────────────────────────────────────────

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('requestId field', () => {
  test('400 response contains requestId (UUID v4)', async () => {
    const res = await request(app).get('/api/v1/tx/0xshort');
    expect(res.body).toHaveProperty('requestId');
    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });
  test('404 response contains requestId (UUID v4)', async () => {
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.code).toBe(404);
    expect(res.body).toHaveProperty('requestId');
    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });
  test('PENDING response contains requestId (UUID v4)', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body).toHaveProperty('requestId');
    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });
  test('SUCCESS response contains requestId (UUID v4)', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.status).toBe('SUCCESS');
    expect(res.body).toHaveProperty('requestId');
    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });
  test('FAILED response contains requestId (UUID v4)', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 21000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 21000n));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.status).toBe('FAILED');
    expect(res.body).toHaveProperty('requestId');
    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });
  test('500 response contains requestId (UUID v4)', async () => {
    mockProvider.getTransaction.mockRejectedValue(new Error('network error'));
    mockProvider.getTransactionReceipt.mockRejectedValue(new Error('network error'));
    mockProvider.getBlockNumber.mockRejectedValue(new Error('network error'));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('requestId');
    expect(res.body.requestId).toMatch(UUID_V4_REGEX);
  });
  test('each request gets a unique requestId', async () => {
    const res1 = await request(app).get('/api/v1/tx/0xshort');
    const res2 = await request(app).get('/api/v1/tx/0xshort');
    expect(res1.body.requestId).not.toBe(res2.body.requestId);
  });
});

// ─── ERC-20 Token Transfer Parsing ───────────────────────────────────────────

describe('tokenTransfers field - no ERC-20 logs', () => {
  test('receipt with empty logs → tokenTransfers is empty array', async () => {
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n, { logs: [] }));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data).toHaveProperty('tokenTransfers');
    expect(res.body.data.tokenTransfers).toEqual([]);
  });

  test('receipt with non-ERC20 logs → tokenTransfers is empty array', async () => {
    const nonTransferLog = {
      address: '0x' + 'c'.repeat(40),
      topics: ['0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'],
      data: '0x' + '0'.repeat(64),
    };
    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n, { logs: [nonTransferLog] }));
    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.tokenTransfers).toEqual([]);
  });
});

describe('tokenTransfers field - with ERC-20 Transfer events', () => {
  const CONTRACT_ADDR = '0x55d398326f99059fF775485246999027B3197955';
  const FROM_ADDR = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const TO_ADDR = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  test('single ERC-20 Transfer → correct tokenTransfers entry', async () => {
    const value = 100n * (10n ** 18n); // 100 USDT (18 decimals)
    const log = makeTransferLog(CONTRACT_ADDR, FROM_ADDR, TO_ADDR, value);

    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n, { logs: [log] }));
    mockContractInstance.symbol.mockResolvedValue('USDT');
    mockContractInstance.decimals.mockResolvedValue(18);

    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const transfers = res.body.data.tokenTransfers;

    expect(transfers).toHaveLength(1);
    expect(transfers[0].contractAddress).toBe(CONTRACT_ADDR);
    expect(transfers[0].symbol).toBe('USDT');
    expect(transfers[0].decimals).toBe(18);
    expect(transfers[0].valueRaw).toBe(value.toString());
    expect(transfers[0].value).toBe('100.00');
  });

  test('multiple ERC-20 Transfers → all returned', async () => {
    const CONTRACT2 = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d';
    const val1 = 50n * (10n ** 18n);
    const val2 = 200n * (10n ** 18n);
    const log1 = makeTransferLog(CONTRACT_ADDR, FROM_ADDR, TO_ADDR, val1);
    const log2 = makeTransferLog(CONTRACT2, TO_ADDR, FROM_ADDR, val2);

    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n, { logs: [log1, log2] }));
    mockContractInstance.symbol.mockResolvedValue('USDC');
    mockContractInstance.decimals.mockResolvedValue(18);

    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const transfers = res.body.data.tokenTransfers;
    expect(transfers).toHaveLength(2);
  });

  test('failed tx with ERC-20 transfer logs → tokenTransfers included', async () => {
    const value = 10n * (10n ** 18n);
    const log = makeTransferLog(CONTRACT_ADDR, FROM_ADDR, TO_ADDR, value);

    mockProvider.getTransaction.mockResolvedValue(makeTx({ gasLimit: 100000n }));
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(0, 50000n, { logs: [log] }));
    mockProvider.call.mockResolvedValue('0x');
    mockContractInstance.symbol.mockResolvedValue('USDT');
    mockContractInstance.decimals.mockResolvedValue(18);

    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.status).toBe('FAILED');
    expect(res.body.data).toHaveProperty('tokenTransfers');
    expect(res.body.data.tokenTransfers).toHaveLength(1);
  });
});

describe('ERC-20 token info cache', () => {
  const CONTRACT_ADDR = '0x55d398326f99059fF775485246999027B3197955';
  const FROM_ADDR = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const TO_ADDR = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  test('second call uses cache, not contract', async () => {
    const value = 100n * (10n ** 18n);
    const log1 = makeTransferLog(CONTRACT_ADDR, FROM_ADDR, TO_ADDR, value);
    const log2 = makeTransferLog(CONTRACT_ADDR, FROM_ADDR, TO_ADDR, value);

    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt
      .mockResolvedValueOnce(makeReceipt(1, 21000n, { logs: [log1] }))
      .mockResolvedValueOnce(makeReceipt(1, 21000n, { logs: [log2] }));
    mockContractInstance.symbol.mockResolvedValue('USDT');
    mockContractInstance.decimals.mockResolvedValue(18);

    // First request
    await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const callCount1 = mockContractInstance.symbol.mock.calls.length;

    // Second request — should use cache
    await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    const callCount2 = mockContractInstance.symbol.mock.calls.length;

    expect(callCount2).toBe(callCount1); // no extra contract call
  });

  test('expired cache → re-fetches from contract', async () => {
    const value = 100n * (10n ** 18n);
    const log = makeTransferLog(CONTRACT_ADDR, FROM_ADDR, TO_ADDR, value);

    // Manually insert an expired cache entry
    tokenCache.set(CONTRACT_ADDR.toLowerCase(), {
      symbol: 'OLD',
      decimals: 18,
      cachedAt: Date.now() - TOKEN_CACHE_TTL_MS - 1000,
    });

    mockProvider.getTransaction.mockResolvedValue(makeTx());
    mockProvider.getTransactionReceipt.mockResolvedValue(makeReceipt(1, 21000n, { logs: [log] }));
    mockContractInstance.symbol.mockResolvedValue('USDT');
    mockContractInstance.decimals.mockResolvedValue(18);

    const res = await request(app).get(`/api/v1/tx/${VALID_TX_HASH}`);
    expect(res.body.data.tokenTransfers[0].symbol).toBe('USDT');
    expect(mockContractInstance.symbol).toHaveBeenCalled();
  });
});

describe('parseTokenTransfers - edge cases', () => {
  test('empty logs array → empty array', async () => {
    const result = await parseTokenTransfers(mockProvider, []);
    expect(result).toEqual([]);
  });

  test('null/undefined logs → empty array', async () => {
    const result = await parseTokenTransfers(mockProvider, null);
    expect(result).toEqual([]);
  });

  test('log with wrong topic[0] → ignored', async () => {
    const badLog = {
      address: '0x' + 'a'.repeat(40),
      topics: ['0x1234000000000000000000000000000000000000000000000000000000000000'],
      data: '0x' + '0'.repeat(64),
    };
    const result = await parseTokenTransfers(mockProvider, [badLog]);
    expect(result).toEqual([]);
  });

  test('contract call failure → UNKNOWN symbol with fallback', async () => {
    mockContractInstance.symbol.mockRejectedValue(new Error('call failed'));
    mockContractInstance.decimals.mockRejectedValue(new Error('call failed'));

    const log = makeTransferLog(
      '0x' + 'e'.repeat(40),
      '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      1000n
    );
    const result = await parseTokenTransfers(mockProvider, [log]);
    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe('UNKNOWN');
  });
});
