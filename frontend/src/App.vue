<template>
  <div class="app-container">
    <!-- Header -->
    <div class="header">
      <div class="header-inner">
        <span class="logo">🔍</span>
        <h1 class="title">TxTracer <span class="subtitle">多链</span></h1>
        <p class="desc">EVM 链上交易查询与失败原因分析工具</p>
      </div>
    </div>

    <!-- Search Area -->
    <div class="search-area">
      <!-- Chain Selector -->
      <div class="chain-selector">
        <a-radio-group v-model:value="selectedChain" button-style="solid" size="large">
          <a-radio-button value="bsc">
            <span class="chain-btn-inner">🟡 BSC</span>
          </a-radio-button>
          <a-radio-button value="base">
            <span class="chain-btn-inner">🔵 Base</span>
          </a-radio-button>
        </a-radio-group>
      </div>
      <a-input-search
        v-model:value="txHash"
        :placeholder="`输入 ${chainLabel} 交易哈希 (0x...)`"
        size="large"
        :loading="loading"
        enter-button="查询"
        @search="handleSearch"
        class="search-input"
      />
    </div>

    <!-- Results -->
    <div class="result-area" v-if="state !== 'idle'">
      
      <!-- Error -->
      <a-alert
        v-if="state === 'error'"
        type="error"
        show-icon
        :message="errorMsg"
        class="result-card"
      />

      <!-- Not Found -->
      <a-result
        v-else-if="state === 'not_found'"
        status="404"
        title="未找到交易"
        sub-title="请确认交易哈希是否正确，或交易尚未被广播到网络。"
        class="result-card"
      >
        <template #extra>
          <a-button @click="reset">重新查询</a-button>
        </template>
      </a-result>

      <!-- Pending -->
      <div v-else-if="state === 'pending'" class="result-card">
        <a-alert
          type="info"
          show-icon
          message="交易待确认 (PENDING)"
          description="该交易已广播但尚未被打包进区块。请稍后刷新查询。"
          class="mb-16"
        />
        <TxBasicCard :data="txData" />
        <div class="btn-row">
          <a-button type="primary" @click="handleSearch">🔄 刷新</a-button>
          <a-button :href="txData.explorerUrl" target="_blank">在 {{ explorerName }} 查看 ↗</a-button>
        </div>
      </div>

      <!-- Success -->
      <div v-else-if="state === 'success'" class="result-card">
        <a-alert type="success" show-icon message="交易成功 (SUCCESS)" class="mb-16" />
        <TxBasicCard :data="txData" />
        <div class="btn-row">
          <a-button :href="txData.explorerUrl" target="_blank">在 {{ explorerName }} 查看 ↗</a-button>
        </div>
      </div>

      <!-- Failed -->
      <div v-else-if="state === 'failed'" class="result-card">
        <a-alert type="error" show-icon message="交易失败 (FAILED)" class="mb-16" />
        
        <!-- Failure Analysis Panel -->
        <div class="failure-panel" v-if="txData.failureInfo">
          <div class="failure-title">⚠️ 失败原因分析</div>
          <div class="failure-body">
            <div class="failure-item">
              <span class="fi-label">错误类型</span>
              <a-tag :color="categoryColor(txData.failureInfo.errorCategory)">
                {{ txData.failureInfo.errorCategory }}
              </a-tag>
              <span class="fi-desc">{{ txData.failureInfo.errorCategoryDesc }}</span>
            </div>
            <div class="failure-item" v-if="txData.failureInfo.revertReason">
              <span class="fi-label">回滚原因</span>
              <code class="fi-code">{{ txData.failureInfo.revertReason }}</code>
            </div>
            <div class="failure-item" v-if="txData.failureInfo.revertReasonRaw">
              <span class="fi-label">原始数据</span>
              <code class="fi-code fi-raw">{{ txData.failureInfo.revertReasonRaw }}</code>
            </div>
            <div class="failure-item suggestion">
              <span class="fi-label">💡 修复建议</span>
              <span class="fi-suggestion">{{ txData.failureInfo.suggestion }}</span>
            </div>
          </div>
        </div>

        <TxBasicCard :data="txData" />
        <div class="btn-row">
          <a-button :href="txData.explorerUrl" target="_blank">在 {{ explorerName }} 查看 ↗</a-button>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { message } from 'ant-design-vue';
import { fetchTransactionV2 } from './api/tx.js';
import TxBasicCard from './components/TxBasicCard.vue';

const txHash = ref('');
const loading = ref(false);
const state = ref('idle'); // idle | error | not_found | pending | success | failed
const txData = ref(null);
const errorMsg = ref('');
const selectedChain = ref('bsc');

const chainLabel = computed(() => {
  return selectedChain.value === 'base' ? 'Base' : 'BSC';
});

const explorerName = computed(() => {
  if (!txData.value) return selectedChain.value === 'base' ? 'Basescan' : 'BscScan';
  return txData.value.chain === 'base' ? 'Basescan' : 'BscScan';
});

function reset() {
  state.value = 'idle';
  txData.value = null;
  errorMsg.value = '';
}

async function handleSearch() {
  const hash = txHash.value.trim();
  if (!hash) {
    message.warning('请输入交易哈希');
    return;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    message.error('交易哈希格式不正确，应为 0x 开头的 64 位十六进制字符串');
    return;
  }

  loading.value = true;
  state.value = 'idle';

  try {
    const result = await fetchTransactionV2(hash, selectedChain.value);

    if (result.code === 404) {
      state.value = 'not_found';
      return;
    }

    if (result.code !== 200) {
      state.value = 'error';
      errorMsg.value = result.message || '查询失败';
      return;
    }

    txData.value = result.data;
    const status = result.data.status;
    if (status === 'PENDING') state.value = 'pending';
    else if (status === 'SUCCESS') state.value = 'success';
    else if (status === 'FAILED') state.value = 'failed';
    else state.value = 'error';

  } catch (err) {
    state.value = 'error';
    errorMsg.value = `请求失败: ${err.message}`;
  } finally {
    loading.value = false;
  }
}

function categoryColor(cat) {
  const map = {
    OUT_OF_GAS: 'orange',
    CONTRACT_REVERT: 'red',
    PANIC: 'volcano',
    UNKNOWN: 'gray',
  };
  return map[cat] || 'red';
}
</script>

<style>
* { box-sizing: border-box; }
body { margin: 0; background: #f0f2f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

.app-container {
  min-height: 100vh;
}

.header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  padding: 40px 20px 50px;
  text-align: center;
  color: white;
}

.header-inner { max-width: 800px; margin: 0 auto; }

.logo { font-size: 48px; display: block; margin-bottom: 12px; }

.title {
  font-size: 36px;
  font-weight: 800;
  margin: 0;
  color: white;
  letter-spacing: 1px;
}

.subtitle {
  color: #f0b90b;
  font-weight: 400;
}

.desc {
  color: rgba(255,255,255,0.7);
  margin: 8px 0 0;
  font-size: 14px;
}

.search-area {
  max-width: 800px;
  margin: -24px auto 32px;
  padding: 0 20px;
  position: relative;
  z-index: 10;
}

.chain-selector {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.chain-btn-inner {
  font-weight: 600;
  letter-spacing: 0.5px;
}

.search-input {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 24px rgba(0,0,0,0.15);
}

.result-area {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 20px 40px;
}

.result-card {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}

.mb-16 { margin-bottom: 16px; }

.failure-panel {
  background: #fff1f0;
  border: 1px solid #ffa39e;
  border-radius: 8px;
  margin-bottom: 20px;
  overflow: hidden;
}

.failure-title {
  background: #ff4d4f;
  color: white;
  padding: 10px 16px;
  font-weight: 600;
  font-size: 15px;
}

.failure-body { padding: 16px; }

.failure-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.failure-item:last-child { margin-bottom: 0; }

.fi-label {
  font-weight: 600;
  color: #666;
  min-width: 80px;
  padding-top: 2px;
  font-size: 13px;
}

.fi-code {
  background: #fff;
  border: 1px solid #ffd6d6;
  border-radius: 4px;
  padding: 2px 8px;
  font-family: monospace;
  font-size: 13px;
  color: #d4380d;
  flex: 1;
  word-break: break-all;
}

.fi-raw {
  font-size: 11px;
  color: #888;
  border-color: #ddd;
}

.fi-desc { color: #595959; font-size: 13px; padding-top: 2px; }

.suggestion { background: #fffbe6; padding: 10px 12px; border-radius: 6px; border: 1px solid #ffe58f; }

.fi-suggestion { color: #614700; font-size: 14px; line-height: 1.6; }

.btn-row {
  display: flex;
  gap: 12px;
  margin-top: 20px;
}
</style>
