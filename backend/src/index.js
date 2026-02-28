require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(cors());
app.use(express.json());

// 静态前端
const path = require('path');
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

const PORT = process.env.PORT || 3000;
const BSC_RPC_PRIMARY = process.env.BSC_RPC_PRIMARY || 'https://bsc-dataseed1.binance.org';
const BSC_RPC_FALLBACK = process.env.BSC_RPC_FALLBACK || 'https://bsc-dataseed2.binance.org';

async function getProvider() {
  try {
    const provider = new ethers.JsonRpcProvider(BSC_RPC_PRIMARY);
    await provider.getBlockNumber();
    return provider;
  } catch (e) {
    console.warn('Primary RPC failed, switching to fallback:', e.message);
    return new ethers.JsonRpcProvider(BSC_RPC_FALLBACK);
  }
}

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

// DEX Swap event topics
const SWAP_V2_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37ef4abab29e4e0fee1d3b3bee';
const SWAP_V3_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

// Minimal ERC20 ABI for symbol and decimals
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

async function getTokenInfo(provider, address) {
  try {
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      contract.symbol().catch(() => 'UNKNOWN'),
      contract.decimals().catch(() => 18),
    ]);
    return { symbol, decimals: Number(decimals) };
  } catch {
    return { symbol: 'UNKNOWN', decimals: 18 };
  }
}

// Known V2 pool → DEX name mapping (can be extended)
const KNOWN_V2_POOLS = {
  // PancakeSwap V2 factory on BSC - we identify by checking factory or just label heuristically
};

async function parseSwapEvents(provider, receipt) {
  const swaps = [];
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  for (const log of (receipt.logs || [])) {
    if (!log.topics || log.topics.length === 0) continue;
    const topic0 = log.topics[0].toLowerCase();

    if (topic0 === SWAP_V2_TOPIC) {
      // Uniswap V2 / PancakeSwap V2 Swap event
      // event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)
      try {
        const decoded = abiCoder.decode(
          ['uint256', 'uint256', 'uint256', 'uint256'],
          log.data
        );
        const [amount0In, amount1In, amount0Out, amount1Out] = decoded;

        const poolAddress = log.address;

        // Get token0, token1 from pool
        const poolAbi = [
          'function token0() view returns (address)',
          'function token1() view returns (address)',
        ];
        const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
        const [token0, token1] = await Promise.all([
          poolContract.token0().catch(() => null),
          poolContract.token1().catch(() => null),
        ]);

        if (!token0 || !token1) continue;

        const [info0, info1] = await Promise.all([
          getTokenInfo(provider, token0),
          getTokenInfo(provider, token1),
        ]);

        // Determine tokenIn and tokenOut
        let tokenIn, tokenOut;
        if (amount0In > 0n) {
          // token0 is in, token1 is out
          tokenIn = {
            symbol: info0.symbol,
            amount: ethers.formatUnits(amount0In, info0.decimals),
            contractAddress: token0,
          };
          tokenOut = {
            symbol: info1.symbol,
            amount: ethers.formatUnits(amount1Out, info1.decimals),
            contractAddress: token1,
          };
        } else {
          // token1 is in, token0 is out
          tokenIn = {
            symbol: info1.symbol,
            amount: ethers.formatUnits(amount1In, info1.decimals),
            contractAddress: token1,
          };
          tokenOut = {
            symbol: info0.symbol,
            amount: ethers.formatUnits(amount0Out, info0.decimals),
            contractAddress: token0,
          };
        }

        // Heuristic: if pool is on BSC, likely PancakeSwap V2, else Uniswap V2
        // We'll label based on chain - provider URL check
        const dex = 'PancakeSwap V2 / Uniswap V2';

        swaps.push({ dex, poolAddress, tokenIn, tokenOut });
      } catch (e) {
        console.warn('Failed to parse V2 swap log:', e.message);
      }
    } else if (topic0 === SWAP_V3_TOPIC) {
      // Uniswap V3 Swap event
      // event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
      try {
        const decoded = abiCoder.decode(
          ['int256', 'int256', 'uint160', 'uint128', 'int24'],
          log.data
        );
        const [amount0, amount1] = decoded;

        const poolAddress = log.address;

        const poolAbi = [
          'function token0() view returns (address)',
          'function token1() view returns (address)',
        ];
        const poolContract = new ethers.Contract(poolAddress, poolAbi, provider);
        const [token0, token1] = await Promise.all([
          poolContract.token0().catch(() => null),
          poolContract.token1().catch(() => null),
        ]);

        if (!token0 || !token1) continue;

        const [info0, info1] = await Promise.all([
          getTokenInfo(provider, token0),
          getTokenInfo(provider, token1),
        ]);

        // In V3, negative amount means outflow (token leaving pool = tokenOut for user)
        // positive amount means inflow (token entering pool = tokenIn for user)
        let tokenIn, tokenOut;
        if (amount0 > 0n) {
          // amount0 is positive: user sends token0, receives token1
          tokenIn = {
            symbol: info0.symbol,
            amount: ethers.formatUnits(amount0, info0.decimals),
            contractAddress: token0,
          };
          tokenOut = {
            symbol: info1.symbol,
            amount: ethers.formatUnits(-amount1, info1.decimals),
            contractAddress: token1,
          };
        } else {
          // amount1 is positive: user sends token1, receives token0
          tokenIn = {
            symbol: info1.symbol,
            amount: ethers.formatUnits(amount1, info1.decimals),
            contractAddress: token1,
          };
          tokenOut = {
            symbol: info0.symbol,
            amount: ethers.formatUnits(-amount0, info0.decimals),
            contractAddress: token0,
          };
        }

        swaps.push({ dex: 'Uniswap V3', poolAddress, tokenIn, tokenOut });
      } catch (e) {
        console.warn('Failed to parse V3 swap log:', e.message);
      }
    }
  }

  return swaps;
}

// Main API
app.get('/api/v1/tx/:txHash', async (req, res) => {
  const { txHash } = req.params;

  // Validate txHash format
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({
      code: 400,
      message: '无效的交易哈希格式，请输入 0x 开头的 64 位十六进制字符串',
      data: null,
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
      return res.json({
        code: 404,
        message: '未找到该交易，请确认哈希是否正确或交易是否已广播',
        data: null,
      });
    }

    // PENDING
    if (!receipt) {
      return res.json({
        code: 200,
        message: 'success',
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

    // Get block for timestamp
    const block = await provider.getBlock(receipt.blockNumber);
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

    if (receipt.status === 1) {
      const swaps = await parseSwapEvents(provider, receipt);
      return res.json({ code: 200, message: 'success', data: { ...baseData, swaps } });
    }

    // Failed — analyze
    const failureInfo = await analyzeFailure(provider, tx, receipt);
    return res.json({
      code: 200,
      message: 'success',
      data: { ...baseData, failureInfo },
    });

  } catch (err) {
    console.error('Error processing tx:', err);
    return res.status(500).json({
      code: 500,
      message: `服务器内部错误: ${err.message}`,
      data: null,
    });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Export app for testing; only start server if run directly
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`TxTracer Backend running on http://localhost:${PORT}`);
    console.log(`Primary RPC: ${BSC_RPC_PRIMARY}`);
    console.log(`Fallback RPC: ${BSC_RPC_FALLBACK}`);
  });
}

module.exports = { app };
