# TxTracer 多链版

> EVM 多链交易查询与失败原因分析工具，支持 BSC 和 Base 链

不只告诉你「交易失败了」，还告诉你**为什么失败、怎么修复**。

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 多链支持 | 支持 BSC 和 Base 链，前端链选择器一键切换 |
| 交易查询 | 输入 TxHash，一键查询链上状态 |
| 交易详情 | From / To / 金额 / Gas / 区块号 / 时间戳 / 确认数 |
| 失败原因分析 | 自动解析 Revert Reason，给出中文失败原因与修复建议 |
| 状态分类 | 覆盖 Pending / Success / Failed / Not Found 四种状态 |
| 快捷跳转 | BSC 跳 BscScan，Base 跳 Basescan |
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
    │   │   └── tx.js         # API 封装（v1/v2）
    │   ├── components/
    │   │   └── TxBasicCard.vue  # 交易详情卡片组件
    │   ├── App.vue            # 主页面（含链选择器）
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
BASE_RPC_PRIMARY=https://mainnet.base.org
BASE_RPC_FALLBACK=https://base.drpc.org
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

### v1 接口（BSC，向下兼容）⚠️ Deprecated

> ⚠️ **v1 已废弃（Deprecated）**，建议使用 v2 接口。v1 保留仅供向下兼容，未来可能移除。

```
GET /api/v1/tx/:txHash
```

固定查询 BSC 链，不支持 chain 参数，保持原有行为不变。响应格式为旧的 `{ code, message, data }` 结构。

### v2 接口（多链 + 新响应结构）

> v2 使用全新的响应结构，返回 `success`、`requestId`、结构化的 `value` 和 `datetime` 对象。

```
GET /api/v2/tx/:txHash?chain=bsc
```

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| txHash | String | 66 位十六进制交易哈希（0x 开头） |

**查询参数：**

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| chain | String | 否 | bsc | 链标识，支持 `bsc` / `base` |

**成功响应：**

```json
{
  "success": true,
  "requestId": "e006d09d-f6b1-4001-9455-7d0049abcce4",
  "data": {
    "txHash": "0xabc123...def456",
    "chain": "bsc",
    "chainName": "BNB Smart Chain",
    "status": "SUCCESS",
    "value": {
      "amount": "0.0001",
      "symbol": "BNB",
      "raw": "100000000000000",
      "decimals": 18
    },
    "datetime": {
      "utc": "2026-02-28T13:51:25Z",
      "local": "2026-02-28 21:51:25",
      "timezone": "Asia/Shanghai",
      "timestamp": 1772267485
    }
  }
}
```

> PENDING 状态时 `datetime` 为 `null`。

**错误响应：**

```json
{
  "success": false,
  "requestId": "uuid-v4",
  "error": {
    "code": "INVALID_TX_HASH",
    "message": "txHash 格式错误，应为 66 位十六进制字符串"
  }
}
```

**错误码：**

| 错误码 | HTTP 状态 | 说明 |
|--------|-----------|------|
| `INVALID_TX_HASH` | 400 | txHash 格式错误 |
| `UNSUPPORTED_CHAIN` | 400 | 不支持的链 |
| `TX_NOT_FOUND` | 404 | 交易不存在 |
| `RPC_ERROR` | 502 | RPC 节点连接失败 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

---

## 支持的链

| 链标识 | 链名称 | 代币 | 区块浏览器 |
|--------|--------|------|-----------|
| `bsc` | BNB Smart Chain | BNB | https://bscscan.com |
| `base` | Base | ETH | https://basescan.org |

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

## datetime 字段
所有包含区块信息的响应（SUCCESS / FAILED）均返回 `datetime` 字段：

| 字段 | 格式 | 时区 | 示例 |
|------|------|------|------|
| datetime | YYYY-MM-DD HH:mm:ss | UTC+8 | 2026-02-28 21:51:25 |

block 为 null 时（极少情况），`datetime` 返回 `null`。

---

## RPC 节点

| 链 | 主节点 | 备用节点 |
|----|--------|---------|
| BSC | https://bsc-dataseed1.binance.org | https://bsc-dataseed2.binance.org |
| Base | https://mainnet.base.org | https://base.drpc.org |

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

### 示例需求一：接入 Base 链

见 [ISSUE-001-add-base-chain-support.md](issues/ISSUE-001-add-base-chain-support.md)

### 示例需求二：修改接口参数与返回值

见 [ISSUE-002-update-api-params-and-response.md](issues/ISSUE-002-update-api-params-and-response.md)
