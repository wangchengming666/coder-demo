require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const { randomUUID } = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

// 静态前端
const path = require('path');
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

const PORT = process.env.PORT || 3000;
const BSC_RPC_PRIMARY = process.env.BSC_RPC_PRIMARY || 'https://bsc-dataseed1.binance.org';
const BSC_RPC_FALLBACK = process.env.BSC_RPC_FALLBACK || 'https://bsc-dataseed2.binance.org';
const ETH_RPC_PRIMARY = process.env.ETH_RPC_PRIMARY || 'https://eth.llamarpc.com';
const ETH_RPC_FALLBACK = process.env.ETH_RPC_FALLBACK || 'https://rpc.ankr.com/eth';

const CHAIN_CONFIG = {
  bsc: {
    name: 'BNB Smart Chain', rpcPrimary: BSC_RPC_PRIMARY, rpcFallback: BSC_RPC_FALLBACK,
    explorerUrl: (txHash) => `https://bscscan.com/tx/${txHash}`, valueSymbol: 'BNB', decimals: 18,
  },
  eth: {
    name: 'Ethereum', rpcPrimary: ETH_RPC_PRIMARY, rpcFallback: ETH_RPC_FALLBACK,
    explorerUrl: (txHash) => `https://etherscan.io/tx/${txHash}`, valueSymbol: 'ETH', decimals: 18,
  },
  arb: {
    name: 'Arbitrum One',
    rpcPrimary: process.env.ARB_RPC_PRIMARY || 'https://arb1.arbitrum.io/rpc',
    rpcFallback: process.env.ARB_RPC_FALLBACK || 'https://rpc.ankr.com/arbitrum',
    explorerUrl: (txHash) => `https://arbiscan.io/tx/${txHash}`, valueSymbol: 'ETH', decimals: 18,
  },
  polygon: {
    name: 'Polygon',
    rpcPrimary: process.env.POLYGON_RPC_PRIMARY || 'https://polygon-rpc.com',
    rpcFallback: process.env.POLYGON_RPC_FALLBACK || 'https://rpc.ankr.com/polygon',
    explorerUrl: (txHash) => `https://polygonscan.com/tx/${txHash}`, valueSymbol: 'MATIC', decimals: 18,
  },
  op: {
    name: 'Optimism',
    rpcPrimary: process.env.OP_RPC_PRIMARY || 'https://mainnet.optimism.io',
    rpcFallback: process.env.OP_RPC_FALLBACK || 'https://rpc.ankr.com/optimism',
    explorerUrl: (txHash) => `https://optimistic.etherscan.io/tx/${txHash}`, valueSymbol: 'ETH', decimals: 18,
  },
};

async function getProvider(chain) {
  chain = chain || 'bsc';
  const config = CHAIN_CONFIG[chain] || CHAIN_CONFIG.bsc;
  try {
    const provider = new ethers.JsonRpcProvider(config.rpcPrimary);
    await provider.getBlockNumber();
    return provider;
  } catch (e) {
    console.warn('Primary RPC failed, switching to fallback:', e.message);
    return new ethers.JsonRpcProvider(config.rpcFallback);
  }
}

// ─── ERC-20 Token Transfer Parsing ───────────────────────────────────────────

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];
const tokenCache = new Map();
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

async function getTokenInfo(provider, contractAddress) {
  const now = Date.now();
  const cached = tokenCache.get(contractAddress.toLowerCase());
  if (cached && now - cached.cachedAt < TOKEN_CACHE_TTL_MS) return { symbol: cached.symbol, decimals: cached.decimals };
  try {
    const contract = new ethers.Contract(contractAddress, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([contract.symbol(), contract.decimals()]);
    const info = { symbol: String(symbol), decimals: Number(decimals), cachedAt: now };
    tokenCache.set(contractAddress.toLowerCase(), info);
    return { symbol: info.symbol, decimals: info.decimals };
  } catch (e) {
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
}

async function parseTokenTransfers(provider, logs) {
  if (!logs || logs.length === 0) return [];
  const transferLogs = logs.filter(
    (log) => log.topics && log.topics[0] && log.topics[0].toLowerCase() === ERC20_TRANSFER_TOPIC
  );
  if (transferLogs.length === 0) return [];
  const transfers = await Promise.all(transferLogs.map(async (log) => {
    try {
      const contractAddress = log.address;
      const from = '0x' + log.topics[1].slice(26);
      const to = '0x' + log.topics[2].slice(26);
      const valueRaw = BigInt(log.data).toString();
      const { symbol, decimals } = await getTokenInfo(provider, contractAddress);
      const valueBig = BigInt(log.data);
      const divisor = BigInt(10) ** BigInt(decimals);
      const intPart = valueBig / divisor;
      const fracPart = valueBig % divisor;
      const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '') || '00';
      const value = `${intPart}.${fracStr.length < 2 ? fracStr.padEnd(2, '0') : fracStr}`;
      return { contractAddress, from: ethers.getAddress(from), to: ethers.getAddress(to), value, valueRaw, symbol, decimals };
    } catch (e) { return null; }
  }));
  return transfers.filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── NFT Transfer Parsing ─────────────────────────────────────────────────────

const ERC721_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ERC1155_TRANSFER_SINGLE_TOPIC = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
const ERC1155_TRANSFER_BATCH_TOPIC = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

function normalizeAddress(topic) { return '0x' + topic.slice(26); }
function parseBigInt(hex) { return BigInt(hex).toString(); }

function parseNftTransfers(logs) {
  const nftTransfers = [];
  for (const log of logs) {
    const topics = log.topics;
    if (!topics || topics.length === 0) continue;
    const topic0 = topics[0].toLowerCase();
    const contractAddress = log.address;
    if (topic0 === ERC721_TRANSFER_TOPIC && topics.length === 4) {
      nftTransfers.push({ contractAddress, standard: 'ERC-721', from: normalizeAddress(topics[1]), to: normalizeAddress(topics[2]), tokenId: parseBigInt(topics[3]), amount: '1' });
      continue;
    }
    if (topic0 === ERC1155_TRANSFER_SINGLE_TOPIC && topics.length === 4) {
      try {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const [id, value] = abiCoder.decode(['uint256', 'uint256'], log.data);
        nftTransfers.push({ contractAddress, standard: 'ERC-1155', from: normalizeAddress(topics[2]), to: normalizeAddress(topics[3]), tokenId: id.toString(), amount: value.toString() });
      } catch (e) {}
      continue;
    }
    if (topic0 === ERC1155_TRANSFER_BATCH_TOPIC && topics.length === 4) {
      try {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const [ids, values] = abiCoder.decode(['uint256[]', 'uint256[]'], log.data);
        const from = normalizeAddress(topics[2]); const to = normalizeAddress(topics[3]);
        for (let i = 0; i < ids.length; i++) {
          nftTransfers.push({ contractAddress, standard: 'ERC-1155', from, to, tokenId: ids[i].toString(), amount: values[i].toString() });
        }
      } catch (e) {}
      continue;
    }
  }
  return nftTransfers;
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── Input Data Decode (4byte.directory) ─────────────────────────────────────

const http = require('http');
const https = require('https');

function fetchJson(url, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'TxTracer/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Request timeout')); });
  });
}

async function decodeMethodInfo(inputData) {
  if (!inputData || inputData === '0x' || inputData.length < 10) return null;
  const selector = inputData.slice(0, 10).toLowerCase();
  try {
    const json = await fetchJson(`https://www.4byte.directory/api/v1/signatures/?hex_signature=${selector}`);
    if (!json.results || json.results.length === 0) return { selector, name: null, signature: null, params: [], decoded: false };
    const signature = json.results[0].text_signature;
    const name = signature.split('(')[0];
    const paramTypesStr = signature.slice(name.length + 1, -1);
    const paramTypes = paramTypesStr ? paramTypesStr.split(',').map(t => t.trim()) : [];
    let params = [];
    if (paramTypes.length > 0 && inputData.length > 10) {
      try {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder();
        const decoded = abiCoder.decode(paramTypes, '0x' + inputData.slice(10));
        params = paramTypes.map((type, i) => ({ name: `param${i}`, type, value: decoded[i] !== undefined ? decoded[i].toString() : null }));
      } catch (e) {
        params = paramTypes.map((type, i) => ({ name: `param${i}`, type, value: null }));
      }
    }
    return { selector, name, signature, params, decoded: true };
  } catch (e) {
    console.warn('4byte.directory lookup failed:', e.message);
    return { selector, name: null, signature: null, params: [], decoded: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── Internal Transactions ────────────────────────────────────────────────────

function flattenCallTrace(callFrame) {
  if (!callFrame) return [];
  const result = [];
  const type = (callFrame.type || '').toUpperCase();
  const valueRaw = callFrame.value ? BigInt(callFrame.value) : 0n;
  result.push({ type, from: callFrame.from || null, to: callFrame.to || null, value: ethers.formatEther(valueRaw), valueRaw: valueRaw.toString(), gas: callFrame.gas || '0x0', gasUsed: callFrame.gasUsed || '0x0', success: !callFrame.error, error: callFrame.error || null });
  if (Array.isArray(callFrame.calls)) { for (const child of callFrame.calls) result.push(...flattenCallTrace(child)); }
  return result;
}

async function getInternalTransactions(rpcUrl, supportsDebug, txHash) {
  if (!supportsDebug) return { internalTxs: null, debugUnsupported: true };
  try {
    const response = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'debug_traceTransaction', params: [txHash, { tracer: 'callTracer' }] }) });
    const json = await response.json();
    if (json.error) { console.warn('debug_traceTransaction error:', json.error.message); return { internalTxs: null, debugUnsupported: true }; }
    const callTrace = json.result;
    if (!callTrace) return { internalTxs: [], debugUnsupported: false };
    return { internalTxs: flattenCallTrace(callTrace), debugUnsupported: false };
  } catch (err) { console.warn('Failed to fetch debug_traceTransaction:', err.message); return { internalTxs: null, debugUnsupported: true }; }
}

// ─────────────────────────────────────────────────────────────────────────────

// ─── DEX Swap Parsing ─────────────────────────────────────────────────────────

const SWAP_V2_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37ef4abab29e4e0fee1d3b3bee';
const SWAP_V3_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
const POOL_ABI = ['function token0() view returns (address)', 'function token1() view returns (address)'];

async function parseSwapEvents(provider, receipt) {
  const swaps = [];
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  for (const log of (receipt.logs || [])) {
    if (!log.topics || log.topics.length === 0) continue;
    const topic0 = log.topics[0].toLowerCase();
    if (topic0 === SWAP_V2_TOPIC) {
      try {
        const [amount0In, amount1In, amount0Out, amount1Out] = abiCoder.decode(['uint256', 'uint256', 'uint256', 'uint256'], log.data);
        const poolContract = new ethers.Contract(log.address, POOL_ABI, provider);
        const [token0, token1] = await Promise.all([poolContract.token0().catch(() => null), poolContract.token1().catch(() => null)]);
        if (!token0 || !token1) continue;
        const [info0, info1] = await Promise.all([getTokenInfo(provider, token0), getTokenInfo(provider, token1)]);
        let tokenIn, tokenOut;
        if (amount0In > 0n) {
          tokenIn = { symbol: info0.symbol, amount: ethers.formatUnits(amount0In, info0.decimals), contractAddress: token0 };
          tokenOut = { symbol: info1.symbol, amount: ethers.formatUnits(amount1Out, info1.decimals), contractAddress: token1 };
        } else {
          tokenIn = { symbol: info1.symbol, amount: ethers.formatUnits(amount1In, info1.decimals), contractAddress: token1 };
          tokenOut = { symbol: info0.symbol, amount: ethers.formatUnits(amount0Out, info0.decimals), contractAddress: token0 };
        }
        swaps.push({ dex: 'PancakeSwap V2 / Uniswap V2', poolAddress: log.address, tokenIn, tokenOut });
      } catch (e) { console.warn('V2 swap parse error:', e.message); }
    } else if (topic0 === SWAP_V3_TOPIC) {
      try {
        const [amount0, amount1] = abiCoder.decode(['int256', 'int256', 'uint160', 'uint128', 'int24'], log.data);
        const poolContract = new ethers.Contract(log.address, POOL_ABI, provider);
        const [token0, token1] = await Promise.all([poolContract.token0().catch(() => null), poolContract.token1().catch(() => null)]);
        if (!token0 || !token1) continue;
        const [info0, info1] = await Promise.all([getTokenInfo(provider, token0), getTokenInfo(provider, token1)]);
        let tokenIn, tokenOut;
        if (amount0 > 0n) {
          tokenIn = { symbol: info0.symbol, amount: ethers.formatUnits(amount0, info0.decimals), contractAddress: token0 };
          tokenOut = { symbol: info1.symbol, amount: ethers.formatUnits(-amount1, info1.decimals), contractAddress: token1 };
        } else {
          tokenIn = { symbol: info1.symbol, amount: ethers.formatUnits(amount1, info1.decimals), contractAddress: token1 };
          tokenOut = { symbol: info0.symbol, amount: ethers.formatUnits(-amount0, info0.decimals), contractAddress: token0 };
        }
        swaps.push({ dex: 'Uniswap V3', poolAddress: log.address, tokenIn, tokenOut });
      } catch (e) { console.warn('V3 swap parse error:', e.message); }
    }
  }
  return swaps;
}

// ─────────────────────────────────────────────────────────────────────────────

const PANIC_CODES = {
  0: '断言失败 (Assert Failed)',
  1: '算术溢出/下溢 (Arithmetic overflow/underflow)',
  17: '数组越界访问 (Array out-of-bounds)',
  18: '除以零 (Division by zero)',
  32: '枚举值越界 (Enum value out of range)',
  33: '错误的存储字节数组编码 (Invalid storage byte array encoding)',
  34: '空数组弹出 (Empty array pop)',
  49: '无效跳转目标 (Invalid jump destination)',
  50: '调用无效合约 (Call to invalid contract)',
  65: '内存分配失败 (Memory allocation failed)',
  81: '访问未初始化变量 (Access to uninitialized variable)',
};

async function analyzeFailure(provider, tx, receipt) {
  const gasUsed = receipt.gasUsed;
  const gasLimit = tx.gasLimit;

  // Check OUT_OF_GAS
  if (gasUsed >= gasLimit) {
    return {
      errorCategory: 'OUT_OF_GAS',
      errorCategoryDesc: 'Gas 耗尽',
      revertReason: null,
      revertReasonRaw: null,
      suggestion: `交易Gas耗尽。当前gasLimit为 ${gasLimit.toString()}，请将 gasLimit 提高至少 ${(gasLimit * 2n).toString()} 再重试。`,
    };
  }

  // Replay via eth_call
  let revertData = '0x';
  try {
    await provider.call({
      to: tx.to,
      from: tx.from,
      data: tx.data,
      value: tx.value,
      gasLimit: tx.gasLimit,
      gasPrice: tx.gasPrice,
      nonce: tx.nonce,
    }, tx.blockNumber);
  } catch (err) {
    // Extract revert data from error
    if (err.data) {
      revertData = err.data;
    } else if (err.error && err.error.data) {
      revertData = err.error.data;
    } else if (typeof err.message === 'string') {
      // Try to extract hex from message
      const match = err.message.match(/0x[0-9a-fA-F]+/);
      if (match) revertData = match[0];
    }
  }

  // CONTRACT_REVERT: Error(string) selector = 0x08c379a0
  if (revertData && revertData.startsWith('0x08c379a0')) {
    try {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const decoded = abiCoder.decode(['string'], '0x' + revertData.slice(10));
      const reason = decoded[0];
      return {
        errorCategory: 'CONTRACT_REVERT',
        errorCategoryDesc: '合约执行回滚',
        revertReason: reason,
        revertReasonRaw: revertData,
        suggestion: getSuggestionForRevert(reason),
      };
    } catch {
      return {
        errorCategory: 'CONTRACT_REVERT',
        errorCategoryDesc: '合约执行回滚',
        revertReason: '无法解码回滚原因',
        revertReasonRaw: revertData,
        suggestion: '请联系合约开发者获取更多信息。',
      };
    }
  }

  // PANIC: Panic(uint256) selector = 0x4e487b71
  if (revertData && revertData.startsWith('0x4e487b71')) {
    try {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const decoded = abiCoder.decode(['uint256'], '0x' + revertData.slice(10));
      const code = Number(decoded[0]);
      const desc = PANIC_CODES[code] || `未知Panic错误码(${code})`;
      return {
        errorCategory: 'PANIC',
        errorCategoryDesc: 'Solidity Panic 错误',
        revertReason: desc,
        revertReasonRaw: revertData,
        suggestion: getPanicSuggestion(code),
      };
    } catch {
      return {
        errorCategory: 'PANIC',
        errorCategoryDesc: 'Solidity Panic 错误',
        revertReason: '无法解码 Panic 错误码',
        revertReasonRaw: revertData,
        suggestion: '合约存在严重逻辑错误，请联系合约开发者。',
      };
    }
  }

  // UNKNOWN
  return {
    errorCategory: 'UNKNOWN',
    errorCategoryDesc: '未知错误',
    revertReason: revertData !== '0x' ? revertData : '无法获取回滚数据',
    revertReasonRaw: revertData,
    suggestion: '请检查交易参数是否正确，或联系合约开发者获取支持。',
  };
}

function getSuggestionForRevert(reason) {
  if (!reason) return '请检查交易参数是否正确。';
  const r = reason.toLowerCase();
  if (r.includes('balance') || r.includes('insufficient')) return '请检查您的代币余额是否充足。';
  if (r.includes('allowance') || r.includes('approved')) return '请先调用 approve() 授权足够的代币额度。';
  if (r.includes('owner') || r.includes('not owner') || r.includes('caller')) return '您没有执行此操作的权限，请确认调用者地址是否正确。';
  if (r.includes('deadline') || r.includes('expired')) return '交易已过期，请重新发起并使用更新的截止时间。';
  if (r.includes('slippage') || r.includes('price impact')) return '价格滑点超出容忍范围，请调高滑点设置或减少交易金额。';
  if (r.includes('pause') || r.includes('paused')) return '合约当前处于暂停状态，请稍后再试。';
  if (r.includes('zero') || r.includes('invalid amount')) return '请确保交易金额大于零且参数合法。';
  return `合约回滚原因：${reason}。请根据错误信息检查您的操作是否符合合约要求。`;
}

function getPanicSuggestion(code) {
  const suggestions = {
    0: '断言失败，合约内部状态异常，请联系开发者。',
    1: '发生算术溢出或下溢，请检查计算参数是否超出范围。',
    17: '数组访问越界，请检查索引参数是否在有效范围内。',
    18: '发生除以零错误，请确保分母不为零。',
    32: '枚举值越界，请检查传入参数是否合法。',
    34: '对空数组执行了 pop() 操作，合约逻辑错误。',
    49: '无效的跳转目标，合约编译或部署存在问题。',
    50: '调用了无效合约（可能是地址为零或非合约地址）。',
    65: '内存分配失败，交易消耗 gas 可能过多。',
    81: '访问了未初始化的存储变量，合约存在逻辑缺陷。',
  };
  return suggestions[code] || '合约发生 Panic 错误，请联系合约开发者。';
}

// V2 API: multi-chain
app.get('/api/v2/tx/:txHash', async (req, res) => {
  const { txHash } = req.params;
  const chain = (req.query.chain || 'bsc').toLowerCase();
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return res.status(400).json({ success: false, error: { code: 'INVALID_TX_HASH', message: 'txHash 格式错误' } });
  if (!CHAIN_CONFIG[chain]) return res.status(400).json({ success: false, error: { code: 'UNSUPPORTED_CHAIN', message: `不支持的链: ${chain}，目前支持: ${Object.keys(CHAIN_CONFIG).join(', ')}` } });
  const chainConfig = CHAIN_CONFIG[chain];
  try {
    const provider = await getProvider(chain);
    const [tx, receipt] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash)]);
    if (!tx) return res.status(404).json({ success: false, error: { code: 'TX_NOT_FOUND', message: '未找到该交易' } });
    let timestamp = null, block = null;
    if (receipt) { block = await provider.getBlock(receipt.blockNumber); timestamp = block ? block.timestamp : null; }
    const status = !receipt ? 'PENDING' : (receipt.status === 1 ? 'SUCCESS' : 'FAILED');
    let txType = null, baseFee = null, maxPriorityFee = null;
    if (chain === 'eth') {
      txType = (tx.type !== undefined && tx.type !== null) ? Number(tx.type) : null;
      if (txType === 2) {
        if (block && block.baseFeePerGas != null) baseFee = parseFloat(ethers.formatUnits(block.baseFeePerGas, 'gwei'));
        if (tx.maxPriorityFeePerGas != null) maxPriorityFee = parseFloat(ethers.formatUnits(tx.maxPriorityFeePerGas, 'gwei'));
      }
    }
    const data = { txHash, chain, chainName: chainConfig.name, status, value: { amount: ethers.formatEther(tx.value), symbol: chainConfig.valueSymbol, raw: tx.value.toString(), decimals: chainConfig.decimals }, timestamp, explorerUrl: chainConfig.explorerUrl(txHash) };
    if (chain === 'eth') { data.txType = txType; data.baseFee = baseFee; data.maxPriorityFee = maxPriorityFee; }
    if (chain === 'arb' && receipt && receipt.l1Fee != null) {
      const l1FeeRaw = BigInt(receipt.l1Fee.toString());
      data.l1Fee = ethers.formatEther(l1FeeRaw);
      data.l1FeeRaw = l1FeeRaw.toString();
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error('Error processing v2 tx:', err);
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: `服务器内部错误: ${err.message}` } });
  }
});

// Main API
app.get('/api/v1/tx/:txHash', async (req, res) => {
  const { txHash } = req.params;
  const requestId = randomUUID();
  console.log(`[${requestId}] Request: ${txHash}`);

  // Validate txHash format
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({
      success: false,
      requestId,
      error: {
        code: 'INVALID_TX_HASH',
        message: '无效的交易哈希格式，请输入 0x 开头的 64 位十六进制字符串',
      },
    });
  }

  try {
    const provider = await getProvider();

    const [tx, receipt, currentBlock] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
      provider.getBlockNumber(),
    ]);

    // Not found
    if (!tx) {
      return res.status(404).json({
        success: false,
        requestId,
        error: {
          code: 'TX_NOT_FOUND',
          message: '未找到该交易，请确认哈希是否正确或交易是否已广播',
        },
      });
    }

    // PENDING
    if (!receipt) {
      return res.json({
        success: true,
        requestId,
        data: {
          txHash,
          status: 'PENDING',
          from: tx.from,
          to: tx.to,
          value: ethers.formatEther(tx.value),
          valueSymbol: 'BNB',
          valueRaw: tx.value.toString(),
          gasLimit: tx.gasLimit.toString(),
          gasPrice: ethers.formatUnits(tx.gasPrice, 'gwei'),
          gasPriceUnit: 'Gwei',
          nonce: tx.nonce,
          inputData: tx.data,
          explorerUrl: `https://bscscan.com/tx/${txHash}`,
        },
      });
    }

    // Get block for timestamp and gas analysis (prefetchTxs=true)
    const block = await provider.getBlock(receipt.blockNumber, true);
    const timestamp = block ? block.timestamp : null;

    // Format datetime in UTC+8
    const datetime = timestamp !== null
      ? new Date(timestamp * 1000).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).replace(/\//g, '-')
      : null;

    const gasUsed = receipt.gasUsed;
    const gasPrice = tx.gasPrice;
    const gasFeeWei = gasUsed * gasPrice;

    // Compute gasAnalysis - compare tx gas price vs block average
    let gasAnalysis = null;
    if (block && block.transactions && block.transactions.length > 0) {
      const txGasPrices = block.transactions
        .map(t => (typeof t === 'object' && t !== null && t.gasPrice != null) ? BigInt(t.gasPrice) : null)
        .filter(p => p !== null);
      if (txGasPrices.length > 0) {
        const sum = txGasPrices.reduce((a, b) => a + b, 0n);
        const avg = sum / BigInt(txGasPrices.length);
        const txGp = BigInt(gasPrice);
        const diffPct = avg !== 0n ? Number((txGp - avg) * 10000n / avg) / 100 : 0;
        const sign = diffPct >= 0 ? '+' : '';
        const level = diffPct < -20 ? 'low' : diffPct > 20 ? 'high' : 'normal';
        gasAnalysis = { txGasPrice: ethers.formatUnits(txGp, 'gwei'), blockAvgGasPrice: ethers.formatUnits(avg, 'gwei'), diff: `${sign}${diffPct.toFixed(1)}%`, level };
      }
    }

    const baseData = {
      txHash,
      status: receipt.status === 1 ? 'SUCCESS' : 'FAILED',
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      timestamp,
      datetime,
      from: tx.from,
      to: tx.to,
      value: ethers.formatEther(tx.value),
      valueSymbol: 'BNB',
      valueRaw: tx.value.toString(),
      gasLimit: tx.gasLimit.toString(),
      gasUsed: gasUsed.toString(),
      gasPrice: ethers.formatUnits(gasPrice, 'gwei'),
      gasPriceUnit: 'Gwei',
      gasFee: ethers.formatEther(gasFeeWei),
      gasFeeSymbol: 'BNB',
      nonce: tx.nonce,
      inputData: tx.data,
      confirmations: currentBlock - receipt.blockNumber,
      explorerUrl: `https://bscscan.com/tx/${txHash}`,
    };

    // Parse ERC-20 transfers, NFT transfers, DEX swaps, internal txs, and method info
    const [tokenTransfers, swaps, { internalTxs, debugUnsupported }, methodInfo] = await Promise.all([
      parseTokenTransfers(provider, receipt.logs),
      parseSwapEvents(provider, receipt),
      getInternalTransactions(BSC_RPC_PRIMARY, true, txHash),
      decodeMethodInfo(tx.data),
    ]);
    const nftTransfers = parseNftTransfers(receipt.logs || []);

    if (receipt.status === 1) {
      const data = { ...baseData, gasAnalysis, methodInfo, tokenTransfers, nftTransfers, swaps };
      if (!debugUnsupported) data.internalTxs = internalTxs;
      else data.internalTxsNote = 'debug_traceTransaction not supported by this node';
      return res.json({ success: true, requestId, data });
    }

    // Failed — analyze
    const failureInfo = await analyzeFailure(provider, tx, receipt);
    const data = { ...baseData, gasAnalysis, methodInfo, tokenTransfers, nftTransfers, swaps, failureInfo };
    if (!debugUnsupported) data.internalTxs = internalTxs;
    else data.internalTxsNote = 'debug_traceTransaction not supported by this node';
    return res.json({ success: true, requestId, data });

  } catch (err) {
    console.error(`[${requestId}] Error processing tx:`, err);
    return res.status(500).json({
      success: false,
      requestId,
      error: {
        code: 'INTERNAL_ERROR',
        message: `服务器内部错误: ${err.message}`,
      },
    });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', requestId: randomUUID() }));

// Export app for testing; only start server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TxTracer Backend running on http://localhost:${PORT}`);
    console.log(`Primary RPC: ${BSC_RPC_PRIMARY}`);
    console.log(`Fallback RPC: ${BSC_RPC_FALLBACK}`);
  });
}

module.exports = { app, parseTokenTransfers, parseSwapEvents, parseNftTransfers, getTokenInfo, tokenCache, TOKEN_CACHE_TTL_MS, decodeMethodInfo, fetchJson };
