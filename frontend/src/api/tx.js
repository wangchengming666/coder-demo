/**
 * TxTracer API封装
 */

const V1_BASE_URL = '/api/v1';
const V2_BASE_URL = '/api/v2';

/**
 * 查询BSC交易详情（v1，仅BSC，向下兼容）
 * @param {string} txHash - 交易哈希
 * @returns {Promise<Object>} 交易数据
 */
export async function fetchTransaction(txHash) {
  const response = await fetch(`${V1_BASE_URL}/tx/${encodeURIComponent(txHash)}`);
  
  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      errMsg = body.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const result = await response.json();
  return result;
}

/**
 * 查询多链交易详情（v2，支持 bsc / base）
 * @param {string} txHash - 交易哈希
 * @param {string} chain - 链名称，bsc 或 base，默认 bsc
 * @returns {Promise<Object>} 交易数据
 */
export async function fetchTransactionV2(txHash, chain = 'bsc') {
  const url = `${V2_BASE_URL}/tx/${encodeURIComponent(txHash)}?chain=${encodeURIComponent(chain)}`;
  const response = await fetch(url);
  
  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      errMsg = body.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const result = await response.json();
  return result;
}
