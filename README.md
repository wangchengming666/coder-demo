# TxTracer 多链交易查询工具

> 支持多链的交易查询与失败原因分析工具（已支持 BSC、Polygon）

不只告诉你「交易失败了」，还告诉你**为什么失败、怎么修复**。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 多链支持 | 支持 BSC、Polygon，通过 chain 参数切换 |
| 交易查询 | 输入 TxHash，一键查询链上状态 |
| 交易详情 | From / To / 金额 / Gas / 区块号 / 时间戳 / 确认数 |
| 失败原因分析 | 自动解析 Revert Reason，给出中文失败原因与修复建议 |
| 状态分类 | 覆盖 Pending / Success / Failed / Not Found 四种状态 |
| 快捷跳转 | 一键跳转 BscScan 区块浏览器 |
| RPC 自动切换 | 主节点失败自动切换备用节点 |

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
│   ├── .env                  # 环境变量配置
│   └── package.json
└── frontend/
    ├── src/
    │   ├── api/
    │   │   └── tx.js         # API 封装
    │   ├── components/
    │   │   └── TxBasicCard.vue  # 交易详情卡片组件
    │   ├── App.vue            # 主页面
    │   └── main.js
    ├── vite.config.js         # 含 /api 代理配置
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
PORT=3000
```

### 2. 前端（开发模式）

```bash
cd frontend
npm install
npm run dev
# 页面运行在 http://localhost:5173
```

### 3. 前端（生产构建，由后端统一提供服务）

```bash
cd frontend
npm run build
# 构建产物输出到 frontend/dist/
# 后端会自动提供静态文件服务，访问 http://localhost:3000 即可
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

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| chain | String | 否 | bsc | 链标识，支持 `bsc`、`polygon` |

**支持的链：**

| chain | 链名 | 原生代币 | 区块浏览器 | EIP-1559 |
|-------|------|----------|------------|----------|
| bsc | BSC | BNB | bscscan.com | 否 |
| polygon | Polygon | MATIC | polygonscan.com | 是 |

**响应示例 — 交易成功：**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "txHash": "0xabc123...def456",
    "status": "SUCCESS",
    "blockNumber": 37500000,
    "blockHash": "0xbbb...",
    "timestamp": 1709100000,
    "from": "0xSenderAddress",
    "to": "0xReceiverAddress",
    "value": "0.0001",
    "valueSymbol": "BNB",
    "valueRaw": "100000000000000",
    "gasLimit": "21000",
    "gasUsed": "21000",
    "gasPrice": "3",
    "gasPriceUnit": "Gwei",
    "gasFee": "0.000063",
    "gasFeeSymbol": "BNB",
    "nonce": 88,
    "inputData": "0x",
    "confirmations": 500,
    "explorerUrl": "https://bscscan.com/tx/0xabc123...",
    "datetime": "2026-02-28 21:51:25"
  }
}
```

**响应示例 — 交易失败（额外返回 failureInfo）：**

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "txHash": "0xabc123...def456",
    "status": "FAILED",
    "failureInfo": {
      "errorCategory": "CONTRACT_REVERT",
      "errorCategoryDesc": "合约执行回滚",
      "revertReason": "ERC20: transfer amount exceeds balance",
      "revertReasonRaw": "0x08c379a0...",
      "suggestion": "请检查您的代币余额是否充足。"
    }
  }
}
```

**响应状态码：**

| code | 说明 |
|------|------|
| 0 | 成功 |
| 400 | txHash 格式错误 |
| 404 | 交易不存在 |
| 500 | 服务器内部错误 |

---

## 失败原因分析

后端通过 `eth_call` 重放失败交易，解析 revert data，分为四种错误类型：

| 错误类型 | 触发条件 | 说明 |
|----------|----------|------|
| `OUT_OF_GAS` | gasUsed ≥ gasLimit | Gas 耗尽，建议提高 gasLimit |
| `CONTRACT_REVERT` | revert data 以 `0x08c379a0` 开头 | 合约主动 revert，解码 Error(string) |
| `PANIC` | revert data 以 `0x4e487b71` 开头 | Solidity Panic 错误，解析错误码 |
| `UNKNOWN` | 其他情况 | 返回原始 revert data |

**支持的 PANIC 错误码：**

| 错误码 | 含义 |
|--------|------|
| 0 | 断言失败 |
| 1 | 算术溢出/下溢 |
| 17 | 数组越界访问 |
| 18 | 除以零 |
| 32 | 枚举值越界 |
| 34 | 空数组执行 pop() |
| 49 | 无效跳转目标 |
| 50 | 调用无效合约 |
| 65 | 内存分配失败 |
| 81 | 访问未初始化变量 |

---

## 字段说明

### datetime 字段
所有包含区块信息的响应（SUCCESS / FAILED）均返回 `datetime` 字段：

| 字段 | 格式 | 时区 | 示例 |
|------|------|------|------|
| datetime | YYYY-MM-DD HH:mm:ss | UTC+8 | 2026-02-28 21:51:25 |

block 为 null 时（极少情况），`datetime` 返回 `null`。

---

## RPC 节点配置

### BSC

| 节点 | 地址 |
|------|------|
| 主节点 | https://bsc-dataseed1.binance.org |
| 备用节点 | https://bsc-dataseed2.binance.org |

### Polygon（ISSUE-005 新增）

| 节点 | 地址 |
|------|------|
| 主节点 | https://polygon-rpc.com |
| 备用节点 | https://rpc.ankr.com/polygon |

Polygon 支持 EIP-1559，响应中包含 `baseFee`（Gwei）和 `maxPriorityFee`（Gwei）字段。

主节点不可用时自动切换备用节点。

---

## 需求管理规范

所有需求统一放在 `issues/` 目录，文件名格式：

```
issues/ISSUE-<编号>-<简短描述>.md
```

示例：
```
issues/ISSUE-001-add-base-chain-support.md
issues/ISSUE-002-update-api-params-and-response.md
```

---

### 需求文档模板

```markdown
# ISSUE-<编号> <需求标题>

**状态：** 待开发 / 开发中 / 已完成  
**优先级：** P0 / P1 / P2  
**提出人：** Vault (PM)  
**日期：** YYYY-MM-DD  

## 背景

说明为什么要做这个需求。

## 需求描述

具体要做什么，面向开发的详细说明。

## 接口变更（如有）

### 变更前

\`\`\`
GET /api/v1/tx/:txHash
\`\`\`

### 变更后

\`\`\`
GET /api/v2/tx/:txHash?chain=bsc
\`\`\`

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| txHash | String | 是 | 交易哈希 |
| chain | String | 否 | 链标识，默认 bsc，支持 bsc / base |

**返回值新增字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| chain | String | 当前查询的链标识 |
| chainName | String | 链的展示名称，如 "BSC" / "Base" |

## 验收标准

- [ ] 功能点 1
- [ ] 功能点 2

## 备注

其他补充说明。
```

---

### 示例需求一：接入 Base 链

见 [ISSUE-001-add-base-chain-support.md](issues/ISSUE-001-add-base-chain-support.md)

### 示例需求二：修改接口参数与返回值

见 [ISSUE-002-update-api-params-and-response.md](issues/ISSUE-002-update-api-params-and-response.md)
