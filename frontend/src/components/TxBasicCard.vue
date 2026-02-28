<template>
  <div class="tx-card">
    <div class="card-title">📋 交易详情</div>
    <table class="detail-table">
      <tbody>
        <tr v-for="row in rows" :key="row.label">
          <td class="label-cell">{{ row.label }}</td>
          <td class="value-cell">
            <template v-if="row.link">
              <a :href="row.link" target="_blank" class="hash-link">{{ row.value }}</a>
            </template>
            <template v-else-if="row.tag">
              <a-tag :color="row.tagColor">{{ row.value }}</a-tag>
            </template>
            <template v-else-if="row.mono">
              <code class="mono-val">{{ row.value }}</code>
            </template>
            <template v-else>
              {{ row.value }}
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  data: { type: Object, required: true }
});

const d = computed(() => props.data);

function formatTimestamp(ts) {
  if (!ts) return '-';
  const date = new Date(ts * 1000);
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) + ' (UTC+8)';
}

function statusColor(status) {
  return { SUCCESS: 'success', FAILED: 'error', PENDING: 'processing' }[status] || 'default';
}

const rows = computed(() => {
  const d2 = d.value;
  const list = [
    { label: '交易哈希', value: d2.txHash, mono: true },
    { label: '状态', value: d2.status, tag: true, tagColor: statusColor(d2.status) },
  ];

  if (d2.blockNumber) list.push({ label: '区块号', value: d2.blockNumber, link: `https://bscscan.com/block/${d2.blockNumber}` });
  if (d2.blockHash) list.push({ label: '区块哈希', value: d2.blockHash, mono: true });
  if (d2.timestamp) list.push({ label: '时间戳', value: formatTimestamp(d2.timestamp) });
  if (d2.confirmations !== undefined) list.push({ label: '确认数', value: d2.confirmations });

  list.push(
    { label: '发送方', value: d2.from, link: `https://bscscan.com/address/${d2.from}` },
    { label: '接收方', value: d2.to || '合约创建', link: d2.to ? `https://bscscan.com/address/${d2.to}` : null },
    { label: '转账金额', value: `${d2.value} ${d2.valueSymbol} (${d2.valueRaw} wei)` },
  );

  if (d2.gasLimit) list.push({ label: 'Gas Limit', value: d2.gasLimit });
  if (d2.gasUsed) list.push({ label: 'Gas Used', value: d2.gasUsed });
  list.push({ label: 'Gas Price', value: `${d2.gasPrice} ${d2.gasPriceUnit}` });
  if (d2.gasFee) list.push({ label: '手续费', value: `${d2.gasFee} ${d2.gasFeeSymbol}` });
  list.push({ label: 'Nonce', value: d2.nonce });

  if (d2.inputData && d2.inputData !== '0x') {
    list.push({ label: '输入数据', value: d2.inputData.length > 100 ? d2.inputData.slice(0, 100) + '...' : d2.inputData, mono: true });
  } else {
    list.push({ label: '输入数据', value: '0x (无数据)' });
  }

  return list;
});
</script>

<style scoped>
.tx-card { border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden; }

.card-title {
  background: #fafafa;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 15px;
  border-bottom: 1px solid #f0f0f0;
}

.detail-table {
  width: 100%;
  border-collapse: collapse;
}

.detail-table tr:nth-child(even) { background: #fafafa; }
.detail-table tr:hover { background: #f5f7ff; }

.label-cell {
  width: 120px;
  padding: 10px 16px;
  color: #666;
  font-size: 13px;
  font-weight: 500;
  vertical-align: top;
  white-space: nowrap;
}

.value-cell {
  padding: 10px 16px;
  font-size: 13px;
  color: #333;
  word-break: break-all;
}

.hash-link {
  color: #1677ff;
  text-decoration: none;
  font-family: monospace;
  font-size: 12px;
}
.hash-link:hover { text-decoration: underline; }

.mono-val {
  font-family: monospace;
  font-size: 12px;
  color: #555;
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
}
</style>
