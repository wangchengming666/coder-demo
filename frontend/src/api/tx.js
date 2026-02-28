/**
 * TxTracer API封装
 */

const BASE_URL = '/api/v1';

/**
 * 查询BSC交易详情
 * @param {string} txHash - 交易哈希
 * @returns {Promise<Object>} 交易数据
 */
export async function fetchTransaction(txHash) {
  const response = await fetch(`${BASE_URL}/tx/${encodeURIComponent(txHash)}`);
  
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
