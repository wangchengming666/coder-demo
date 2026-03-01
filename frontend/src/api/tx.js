export async function fetchTransaction(txHash, chain = 'bsc') {
  const url = `/api/v2/tx/${encodeURIComponent(txHash)}?chain=${encodeURIComponent(chain)}`;
  const response = await fetch(url);
  const result = await response.json();
  if (result.success === false) {
    if (response.status === 404) return { code: 404, message: result.error?.message || '未找到', data: null };
    return { code: response.status || 400, message: result.error?.message || '查询失败', data: null };
  }
  return { code: 0, message: 'success', data: result.data };
}
