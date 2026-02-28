/**
 * TxTracer API封装
 */
const BASE_URL_V2 = '/api/v2';
const BASE_URL_V1 = '/api/v1';

export async function fetchTransaction(txHash, chain) {
  chain = chain || 'bsc';
  const url = BASE_URL_V2 + '/tx/' + encodeURIComponent(txHash) + '?chain=' + encodeURIComponent(chain);
  const response = await fetch(url);
  if (!response.ok) {
    let errMsg = 'HTTP ' + response.status;
    try { const b = await response.json(); errMsg = b.message || errMsg; } catch(e) {}
    throw new Error(errMsg);
  }
  return response.json();
}

export async function fetchTransactionV1(txHash) {
  const response = await fetch(BASE_URL_V1 + '/tx/' + encodeURIComponent(txHash));
  if (!response.ok) {
    let errMsg = 'HTTP ' + response.status;
    try { const b = await response.json(); errMsg = b.message || errMsg; } catch(e) {}
    throw new Error(errMsg);
  }
  return response.json();
}
