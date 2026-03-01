# TxTracer

> 多链交易查询与深度分析工具，不只告诉你「交易失败了」，还告诉你**为什么失败、怎么修复**。

---

## 支持的链

| 链 | chain 参数 | 浏览器 |
|----|-----------|--------|
| BNB Smart Chain | `bsc` | BscScan |
| Base | `base` | Basescan |
| Ethereum | `eth` | Etherscan |
| Arbitrum One | `arb` | Arbiscan |
| Polygon | `polygon` | Polygonscan |
| Optimism | `op` | Optimism Explorer |

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 多链交易查询 | 支持 BSC / Base / ETH / ARB / Polygon / OP，输入 TxHash 一键查询 |
| 交易详情 | From / To / 金额 / Gas / 区块号 / 时间戳 / 确认数 |
| 失败原因分析 | 自动解析 Revert Reason，给出中文失败原因与修复建议 |
| 状态分类 | 覆盖 Pending / Success / Failed / Not Found 四种状态 |
| ERC-20 转账解析 | 自动扫描 receipt.logs，解析代币转账明细（symbol、amount、合约地址） |
| NFT 转账解析 | 支持 ERC-721 / ERC-1155 转账，TransferBatch 自动拆分 |
| DEX Swap 解析 | 支持 PancakeSwap V2 / Uniswap V2 / Uniswap V3 Swap 事件解析 |
| Internal Transactions | 通过 debug_traceTransaction 递归解析内部调用树 |
| Gas 费用分析 | 对比当前交易 gasPrice 与区块均价，给出 low / normal / high 评级 |
| Input Data 解码 | 调用 4byte.directory API 解析合约方法名与参数 |
| MEV 夹心攻击检测 | 检测同区块 sandwich 攻击，标记攻击者地址与利润 |
| EIP-1559 字段 | ETH 链额外返回 txType / baseFee / maxPriorityFee |
| L1 Fee 字段 | ARB / OP 链额外返回 L1 手续费 |
| RPC 自动切换 | 主节点失败自动切换备用节点 |
| 快捷跳转 | 一键跳转对应链的区块浏览器 |

---

## 技术栈

- **后端**：Node.js + Express + ethers.js
- **前端**：Vue 3 + Ant Design Vue + Vite

---

## 项目结构

```
coder-demo/
├── backend/
│   ├── src/
│   │   └── index.js          # Express 服务入口，含查询逻辑与失败分析
│   ├── tests/
│   │   └── tx.test.js        # Jest 单元测试（覆盖率 95%+）
│   └── package.json
└── frontend/
    ├── src/
    │   ├── api/tx.js          # API 封装
    │   ├── components/
    │   │   └── TxBasicCard.vue
    │   ├── App.vue
    │   └── main.js
    └── package.json
```

---

## 快速启动

### 1. 后端

```bash
cd backend
npm install
node src/index.js
# 服务运行在 http://localhost:3000
```

**环境变量（backend/.env）：**

```env
BSC_RPC_PRIMARY=https://bsc-dataseed1.binance.org
BSC_RPC_FALLBACK=https://bsc-dataseed2.binance.org
BASE_RPC_PRIMARY=https://mainnet.base.org
BASE_RPC_FALLBACK=https://base.drpc.org
ETH_RPC_PRIMARY=https://eth.llamarpc.com
ETH_RPC_FALLBACK=https://rpc.ankr.com/eth
ARB_RPC_PRIMARY=https://arb1.arbitrum.io/rpc
ARB_RPC_FALLBACK=https://rpc.ankr.com/arbitrum
POLYGON_RPC_PRIMARY=https://polygon-rpc.com
POLYGON_RPC_FALLBACK=https://rpc.ankr.com/polygon
OP_RPC_PRIMARY=https://mainnet.optimism.io
OP_RPC_FALLBACK=https://rpc.ankr.com/optimism
PORT=3000
```

### 2. 前端（开发模式）

```bash
cd frontend
npm install
npm run dev
# 页面运行在 http://localhost:5173
```

### 3. 前端（生产构建）

```bash
cd frontend
npm run build
# 后端自动提供静态文件，访问 http://localhost:3000 即可
```

---

## API 接口

### 查询交易

```
GET /api/v1/tx/:txHash?chain=bsc
```

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| txHash | String | 66 位十六进制交易哈希（0x 开头） |

**查询参数：**

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| chain | String | 否 | `bsc` | 链标识：bsc / base / eth / arb / polygon / op |

---

### 响应格式

**成功：**
```json
{ "success": true, "requestId": "uuid-v4", "data": { ... } }
```

**失败：**
```json
{ "success": false, "requestId": "uuid-v4", "error": { "code": "ERROR_CODE", "message": "..." } }
```

**错误码：**

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| INVALID_TX_HASH | 400 | txHash 格式错误 |
| TX_NOT_FOUND | 404 | 交易不存在 |
| RPC_ERROR | 502 | RPC 调用失败 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |

---

### 响应字段说明

#### 基础字段（所有状态）

| 字段 | 类型 | 说明 |
|------|------|------|
| txHash | String | 交易哈希 |
| status | String | SUCCESS / FAILED / PENDING / NOT_FOUND |
| chain | String | 链标识 |
| chainName | String | 链名称 |
| explorerUrl | String | 区块浏览器链接 |
| requestId | String | 本次请求 UUID |

#### SUCCESS / FAILED 额外字段

| 字段 | 类型 | 说明 |
|------|------|------|
| blockNumber | Number | 区块号 |
| timestamp | Number | Unix 时间戳 |
| datetime | String | 时间（UTC+8，格式 YYYY-MM-DD HH:mm:ss） |
| from | String | 发送方地址 |
| to | String | 接收方地址 |
| value | String | 原生代币数量（ETH/BNB/MATIC 等） |
| valueSymbol | String | 原生代币符号 |
| gasLimit | String | Gas 上限 |
| gasUsed | String | 实际消耗 Gas |
| gasPrice | String | Gas 价格（Gwei） |
| gasFee | String | 实际手续费（原生代币） |
| nonce | Number | Nonce |
| inputData | String | 原始 input data |
| confirmations | Number | 确认数 |

#### ETH 链额外字段

| 字段 | 类型 | 说明 |
|------|------|------|
| txType | Number | 交易类型（0=Legacy，2=EIP-1559） |
| baseFee | String | 区块 baseFee（Gwei） |
| maxPriorityFee | String | maxPriorityFeePerGas（Gwei） |

#### ARB / OP 链额外字段

| 字段 | 类型 | 说明 |
|------|------|------|
| l1Fee | String | L1 手续费（原生代币，如 ETH） |
| l1FeeRaw | String | L1 手续费原始 wei 值 |

#### FAILED 额外字段

| 字段 | 类型 | 说明 |
|------|------|------|
| failureInfo.errorCategory | String | OUT_OF_GAS / CONTRACT_REVERT / PANIC / UNKNOWN |
| failureInfo.errorCategoryDesc | String | 中文错误类型描述 |
| failureInfo.revertReason | String | 解码后的 revert 原因 |
| failureInfo.revertReasonRaw | String | 原始 revert data |
| failureInfo.suggestion | String | 修复建议 |

#### ERC-20 转账（tokenTransfers）

| 字段 | 类型 | 说明 |
|------|------|------|
| tokenTransfers | Array | ERC-20 转账列表（空则为 []） |
| tokenTransfers[].from | String | 转出地址 |
| tokenTransfers[].to | String | 转入地址 |
| tokenTransfers[].value | String | 转账数量（已格式化） |
| tokenTransfers[].symbol | String | 代币符号 |
| tokenTransfers[].contractAddress | String | 合约地址 |

#### NFT 转账（nftTransfers）

| 字段 | 类型 | 说明 |
|------|------|------|
| nftTransfers | Array | NFT 转账列表（空则为 []） |
| nftTransfers[].standard | String | ERC-721 / ERC-1155 |
| nftTransfers[].from | String | 转出地址 |
| nftTransfers[].to | String | 转入地址 |
| nftTransfers[].tokenId | String | Token ID |
| nftTransfers[].amount | String | 数量（ERC-1155 有效） |
| nftTransfers[].contractAddress | String | NFT 合约地址 |

#### DEX Swap（swaps）

| 字段 | 类型 | 说明 |
|------|------|------|
| swaps | Array | Swap 事件列表（空则为 []） |
| swaps[].dex | String | PancakeSwap V2 / Uniswap V2 / Uniswap V3 |
| swaps[].poolAddress | String | 流动性池地址 |
| swaps[].tokenIn.symbol | String | 卖出代币符号 |
| swaps[].tokenIn.amount | String | 卖出数量 |
| swaps[].tokenIn.contractAddress | String | 卖出代币合约 |
| swaps[].tokenOut.symbol | String | 买入代币符号 |
| swaps[].tokenOut.amount | String | 买入数量 |
| swaps[].tokenOut.contractAddress | String | 买入代币合约 |

#### Internal Transactions（internalTxs）

| 字段 | 类型 | 说明 |
|------|------|------|
| internalTxs | Array | 内部调用列表（需 RPC 支持 debug_traceTransaction） |
| internalTxs[].type | String | CALL / DELEGATECALL / CREATE 等 |
| internalTxs[].from | String | 调用方 |
| internalTxs[].to | String | 被调用方 |
| internalTxs[].value | String | 随调用发送的原生代币 |
| debugUnsupported | Boolean | true 表示当前节点不支持 debug，返回空 internalTxs |

#### Gas 费用分析（gasAnalysis）

| 字段 | 类型 | 说明 |
|------|------|------|
| gasAnalysis.txGasPrice | String | 本交易 gasPrice（Gwei） |
| gasAnalysis.blockAvgGasPrice | String | 所在区块平均 gasPrice（Gwei） |
| gasAnalysis.diffPercent | String | 差异百分比（如 "+15.3%" / "-8.2%"） |
| gasAnalysis.rating | String | low / normal / high |

> 评级规则：低于均价 20%+ → `low`；均价 ±20% 内 → `normal`；高于均价 20%+ → `high`
> PENDING 或无区块数据时不返回该字段。

#### Input Data 解码（methodInfo）

| 字段 | 类型 | 说明 |
|------|------|------|
| methodInfo | Object/null | 原生转账（inputData === "0x"）时为 null |
| methodInfo.selector | String | 方法选择器（前 4 字节） |
| methodInfo.signature | String | 方法签名（如 transfer(address,uint256)） |
| methodInfo.decoded | Boolean | 是否解码成功 |
| methodInfo.params | Array | 解码后的参数列表 |

#### MEV 夹心攻击检测（mevInfo）

| 字段 | 类型 | 说明 |
|------|------|------|
| mevInfo | Object/null | 未检测到攻击时为 null |
| mevInfo.detected | Boolean | 是否检测到 sandwich 攻击 |
| mevInfo.attackerAddress | String | 攻击者地址 |
| mevInfo.frontrunTxHash | String | 前置交易哈希 |
| mevInfo.backrunTxHash | String | 后置交易哈希 |
| mevInfo.estimatedProfit | String | 估算利润（原生代币） |

---

### 完整响应示例（BSC 成功交易）

```json
{
  "success": true,
  "requestId": "a1b2c3d4-...",
  "data": {
    "txHash": "0xabc...",
    "status": "SUCCESS",
    "chain": "bsc",
    "chainName": "BSC",
    "blockNumber": 37500000,
    "datetime": "2026-02-28 21:51:25",
    "from": "0xSender...",
    "to": "0xReceiver...",
    "value": "0.0001",
    "valueSymbol": "BNB",
    "gasUsed": "85000",
    "gasPrice": "3",
    "gasFee": "0.000255",
    "gasFeeSymbol": "BNB",
    "inputData": "0xa9059cbb...",
    "explorerUrl": "https://bscscan.com/tx/0xabc...",
    "tokenTransfers": [
      {
        "from": "0xSender...",
        "to": "0xReceiver...",
        "value": "100.0",
        "symbol": "USDT",
        "contractAddress": "0x55d398..."
      }
    ],
    "nftTransfers": [],
    "swaps": [],
    "internalTxs": [],
    "gasAnalysis": {
      "txGasPrice": "3.0",
      "blockAvgGasPrice": "3.2",
      "diffPercent": "-6.3%",
      "rating": "normal"
    },
    "methodInfo": {
      "selector": "0xa9059cbb",
      "signature": "transfer(address,uint256)",
      "decoded": true,
      "params": ["0xReceiver...", "100000000000000000000"]
    },
    "mevInfo": null
  }
}
```

---

## 失败原因分析

| 错误类型 | 触发条件 | 说明 |
|----------|----------|------|
| `OUT_OF_GAS` | gasUsed ≥ gasLimit | Gas 耗尽，建议提高 gasLimit |
| `CONTRACT_REVERT` | revert data 以 `0x08c379a0` 开头 | 合约主动 revert，解码 Error(string) |
| `PANIC` | revert data 以 `0x4e487b71` 开头 | Solidity Panic 错误，解析错误码 |
| `UNKNOWN` | 其他情况 | 返回原始 revert data |

---

## 需求管理规范

所有需求统一放在 `issues/` 目录，文件名格式：

```
issues/ISSUE-<编号>-<简短描述>.md
```

---

## 已完成需求列表

| 编号 | 需求 | PR |
|------|------|----|
| ISSUE-001 | Base 链支持 | #6 |
| ISSUE-002 | v2 API 新响应结构 | #7 |
| ISSUE-003 | Ethereum 主网支持 | #8 |
| ISSUE-004 | Arbitrum One 支持 | #11 |
| ISSUE-005 | Polygon 主网支持 | #12 |
| ISSUE-006 | Optimism 主网支持 | #13 |
| ISSUE-007 | ERC-20 转账解析 | #14 |
| ISSUE-008 | NFT 转账解析 | #15 |
| ISSUE-009 | DEX Swap 事件解析 | #16 |
| ISSUE-010 | Internal Transactions | #17 |
| ISSUE-011 | Gas 费用对比分析 | #18 |
| ISSUE-012 | Input Data 解码 | #19 |
| ISSUE-013 | MEV 夹心攻击检测 | — |
| ISSUE-014 | 统一 v1 响应格式 | #9 |
| ISSUE-015 | requestId 全局注入 | #10 |
