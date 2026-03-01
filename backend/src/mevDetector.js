/**
 * MEV Sandwich Attack Heuristic Detector
 *
 * Checks if a target transaction is sandwiched by:
 *   front-run tx (same block, before target, same pair/swap topic)
 *   back-run tx  (same block, after target, from same or related address)
 * with opposite swap direction.
 *
 * This is heuristic-based and may have false positives.
 */

// Common Swap function selectors (Uniswap V2/V3, PancakeSwap, etc.)
const SWAP_SELECTORS = new Set([
  '0x38ed1739', // swapExactTokensForTokens
  '0x8803dbee', // swapTokensForExactTokens
  '0x7ff36ab5', // swapExactETHForTokens
  '0x4a25d94a', // swapTokensForExactETH
  '0x18cbafe5', // swapExactTokensForETH
  '0xfb3bdb41', // swapETHForExactTokens
  '0x5c11d795', // swapExactTokensForTokensSupportingFeeOnTransferTokens
  '0xb6f9de95', // swapExactETHForTokensSupportingFeeOnTransferTokens
  '0x791ac947', // swapExactTokensForETHSupportingFeeOnTransferTokens
  '0x414bf389', // exactInputSingle (Uniswap V3)
  '0xdb3e2198', // exactOutputSingle (Uniswap V3)
  '0xc04b8d59', // exactInput (Uniswap V3)
  '0xf28c0498', // exactOutput (Uniswap V3)
]);

// Swap event topic: Transfer / Swap (PancakeSwap/Uniswap V2 Swap event)
const SWAP_EVENT_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

/**
 * Returns true if the transaction looks like a Swap.
 * @param {object} tx - transaction object with .data field
 */
function isSwapTransaction(tx) {
  if (!tx || !tx.data || tx.data.length < 10) return false;
  const selector = tx.data.slice(0, 10).toLowerCase();
  return SWAP_SELECTORS.has(selector);
}

/**
 * Extract the pair/router contract from a tx receipt log.
 * Returns the address that emitted the Swap event, or null.
 */
function extractSwapPair(receipt) {
  if (!receipt || !receipt.logs) return null;
  for (const log of receipt.logs) {
    if (log.topics && log.topics[0] && log.topics[0].toLowerCase() === SWAP_EVENT_TOPIC) {
      return log.address ? log.address.toLowerCase() : null;
    }
  }
  return null;
}

/**
 * Get the swap direction from receipt logs (simplified: which token goes in).
 * Returns 'buy' or 'sell' based on amount0In/amount1In in Swap event.
 */
function extractSwapDirection(receipt) {
  if (!receipt || !receipt.logs) return null;
  for (const log of receipt.logs) {
    if (log.topics && log.topics[0] && log.topics[0].toLowerCase() === SWAP_EVENT_TOPIC) {
      if (!log.data || log.data === '0x') return null;
      try {
        // Swap event data: amount0In, amount1In, amount0Out, amount1Out (each 32 bytes)
        const raw = log.data.slice(2);
        if (raw.length < 256) return null;
        const amount0In = BigInt('0x' + raw.slice(0, 64));
        const amount1In = BigInt('0x' + raw.slice(64, 128));
        if (amount0In > 0n) return 'token0in'; // buying token1
        if (amount1In > 0n) return 'token1in'; // buying token0
      } catch { /* ignore */ }
      return null;
    }
  }
  return null;
}

/**
 * Detect MEV sandwich attack for the given transaction.
 *
 * @param {object} provider - ethers provider
 * @param {object} tx - the target transaction
 * @param {object} receipt - the target receipt
 * @returns {object|null} mevInfo or null
 */
async function detectSandwich(provider, tx, receipt) {
  // Non-Swap → null immediately
  if (!isSwapTransaction(tx)) {
    return null;
  }

  // Get the pair contract from target tx receipt
  const targetPair = extractSwapPair(receipt);
  const targetDirection = extractSwapDirection(receipt);

  // Get full block transactions
  const block = await provider.getBlock(receipt.blockNumber, true); // prefetchTxs = true
  if (!block || !block.transactions || block.transactions.length === 0) {
    return { isSuspicious: false, attackType: null, frontRunTx: null, backRunTx: null, estimatedLoss: null, confidence: 'low' };
  }

  const txs = block.transactions;

  // Find target tx index in block
  const targetIndex = txs.findIndex(t => {
    const h = typeof t === 'string' ? t : t.hash;
    return h && h.toLowerCase() === tx.hash.toLowerCase();
  });

  if (targetIndex === -1) {
    return { isSuspicious: false, attackType: null, frontRunTx: null, backRunTx: null, estimatedLoss: null, confidence: 'low' };
  }

  // Collect candidate swap txns before and after
  const candidates = [];
  for (let i = 0; i < txs.length; i++) {
    if (i === targetIndex) continue;
    const t = txs[i];
    if (typeof t === 'string') continue; // no full tx data
    if (!isSwapTransaction(t)) continue;
    // Same router/pair? Use tx.to as proxy (same DEX router)
    if (!t.to || !tx.to) continue;
    if (t.to.toLowerCase() !== tx.to.toLowerCase()) continue;
    candidates.push({ index: i, tx: t });
  }

  // Look for front-run (before target) and back-run (after target) from same address
  const before = candidates.filter(c => c.index < targetIndex);
  const after = candidates.filter(c => c.index > targetIndex);

  let frontRun = null;
  let backRun = null;
  let attackerAddress = null;

  // Check each before-tx: find a matching after-tx from same address
  for (const b of before) {
    const matchAfter = after.find(a => a.tx.from && b.tx.from && a.tx.from.toLowerCase() === b.tx.from.toLowerCase());
    if (matchAfter) {
      frontRun = b;
      backRun = matchAfter;
      attackerAddress = b.tx.from.toLowerCase();
      break;
    }
  }

  if (!frontRun || !backRun) {
    // Check for front-run only
    if (before.length > 0) {
      return {
        isSuspicious: true,
        attackType: 'frontrun',
        frontRunTx: before[before.length - 1].tx.hash,
        backRunTx: null,
        estimatedLoss: null,
        confidence: 'low',
      };
    }
    return { isSuspicious: false, attackType: null, frontRunTx: null, backRunTx: null, estimatedLoss: null, confidence: 'low' };
  }

  // Determine confidence
  let confidence = 'medium';
  // If attacker is NOT the target tx sender, higher confidence
  if (attackerAddress && attackerAddress !== tx.from.toLowerCase()) {
    confidence = 'high';
  }
  // If we also have pair-level confirmation
  if (targetPair) {
    confidence = 'high';
  }

  return {
    isSuspicious: true,
    attackType: 'sandwich',
    frontRunTx: frontRun.tx.hash,
    backRunTx: backRun.tx.hash,
    estimatedLoss: null, // Requires price oracle; left for future implementation
    confidence,
  };
}

/**
 * Safe wrapper: returns mevInfo or null if detection fails.
 * Never throws.
 */
async function detectSandwichSafe(provider, tx, receipt) {
  try {
    return await detectSandwich(provider, tx, receipt);
  } catch (err) {
    console.warn('[MEV] Detection failed (graceful degradation):', err.message);
    return null;
  }
}

module.exports = {
  isSwapTransaction,
  detectSandwich,
  detectSandwichSafe,
  SWAP_SELECTORS,
  SWAP_EVENT_TOPIC,
  extractSwapPair,
  extractSwapDirection,
};
