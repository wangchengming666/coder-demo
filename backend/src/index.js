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

// Multi-chain config
const CHAIN_CONFIG = {
  bsc: {
    rpcPrimary: process.env.BSC_RPC_PRIMARY || 'https://bsc-dataseed1.binance.org',
    rpcFallback: process.env.BSC_RPC_FALLBACK || 'https://bsc-dataseed2.binance.org',
    explorerUrl: 'https://bscscan.com/tx/:txHash',
    symbol: 'BNB',
    decimals: 18,
    chainName: 'BNB Smart Chain',
  },
  arb: {
    rpcPrimary: process.env.ARB_RPC_PRIMARY || 'https://arb1.arbitrum.io/rpc',
    rpcFallback: process.env.ARB_RPC_FALLBACK || 'https://rpc.ankr.com/arbitrum',
    explorerUrl: 'https://arbiscan.io/tx/:txHash',
    symbol: 'ETH',
    decimals: 18,
    chainName: 'Arbitrum One',
  },
};

async function getProviderForChain(chainConfig) {
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcPrimary);
    await provider.getBlockNumber();
    return provider;
  } catch (e) {
    console.warn('Primary RPC failed for chain, switching to fallback:', e.message);
    return new ethers.JsonRpcProvider(chainConfig.rpcFallback);
  }
}

async function getArbL1Fee(provider, receipt) {
  if (receipt.l1Fee !== undefined && receipt.l1Fee !== null) {
    const l1FeeRaw = BigInt(receipt.l1Fee.toString());
    return { l1Fee: ethers.formatEther(l1FeeRaw), l1FeeRaw: l1FeeRaw.toString() };
  }
  return { l1Fee: null, l1FeeRaw: null };
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
      return res.json({ code: 200, message: 'success', data: baseData });
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

// v2 API - Multi-chain support
app.get('/api/v2/tx/:txHash', async (req, res) => {
  const { txHash } = req.params;
  const chain = (req.query.chain || 'bsc').toLowerCase();

  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ code: 400, message: 'invalid hash', data: null });
  }

  const chainConfig = CHAIN_CONFIG[chain];
  if (!chainConfig) {
    return res.status(400).json({ code: 400, message: `unsupported chain: ${chain}`, data: null });
  }

  const explorerUrl = chainConfig.explorerUrl.replace(':txHash', txHash);

  try {
    const provider = await getProviderForChain(chainConfig);
    const [tx, receipt, currentBlock] = await Promise.all([
      provider.getTransaction(txHash),
      provider.getTransactionReceipt(txHash),
      provider.getBlockNumber(),
    ]);

    if (!tx) {
      return res.json({ code: 404, message: 'tx not found', data: null });
    }

    if (!receipt) {
      return res.json({ code: 200, message: 'success', data: {
        txHash, chain, chainName: chainConfig.chainName, status: 'PENDING',
        from: tx.from, to: tx.to,
        value: ethers.formatEther(tx.value), valueSymbol: chainConfig.symbol,
        valueRaw: tx.value.toString(),
        gasLimit: tx.gasLimit.toString(),
        gasPrice: ethers.formatUnits(tx.gasPrice, 'gwei'), gasPriceUnit: 'Gwei',
        nonce: tx.nonce, inputData: tx.data, explorerUrl,
      }});
    }

    const block = await provider.getBlock(receipt.blockNumber);
    const timestamp = block ? block.timestamp : null;
    const datetime = timestamp !== null
      ? new Date(timestamp * 1000).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).replace(/\//g, '-')
      : null;

    const gasUsed = receipt.gasUsed;
    const gasPrice = tx.gasPrice;
    const gasFeeWei = gasUsed * gasPrice;

    const baseData = {
      txHash, chain, chainName: chainConfig.chainName,
      status: receipt.status === 1 ? 'SUCCESS' : 'FAILED',
      blockNumber: receipt.blockNumber, blockHash: receipt.blockHash,
      timestamp, datetime, from: tx.from, to: tx.to,
      value: ethers.formatEther(tx.value), valueSymbol: chainConfig.symbol,
      valueRaw: tx.value.toString(), gasLimit: tx.gasLimit.toString(),
      gasUsed: gasUsed.toString(),
      gasPrice: ethers.formatUnits(tx.gasPrice, 'gwei'), gasPriceUnit: 'Gwei',
      gasFee: ethers.formatEther(gasFeeWei), gasFeeSymbol: chainConfig.symbol,
      nonce: tx.nonce, inputData: tx.data,
      confirmations: currentBlock - receipt.blockNumber, explorerUrl,
    };

    if (chain === 'arb') {
      const arbFee = await getArbL1Fee(provider, receipt);
      if (arbFee.l1Fee !== null) {
        baseData.l1Fee = arbFee.l1Fee;
        baseData.l1FeeRaw = arbFee.l1FeeRaw;
      }
    }

    if (receipt.status === 1) {
      return res.json({ code: 200, message: 'success', data: baseData });
    }

    const failureInfo = await analyzeFailure(provider, tx, receipt);
    return res.json({ code: 200, message: 'success', data: { ...baseData, failureInfo } });

  } catch (err) {
    console.error('Error processing tx:', err);
    return res.status(500).json({ code: 500, message: `server error: ${err.message}`, data: null });
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

module.exports = { app, CHAIN_CONFIG };
