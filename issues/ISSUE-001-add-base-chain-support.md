# ISSUE-001 接入 Base 链

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

目前 TxTracer 仅支持 BSC 链。Base 链（Coinbase L2，基于 OP Stack）用户增长快，有大量交易查询需求，且与 BSC 共用 EVM 标准，接入成本低。

## 需求描述

在现有架构基础上，新增对 Base 链的支持，用户可选择查询 BSC 或 Base 链上的交易。

**具体要求：**

1. 后端支持 Base 链 RPC 节点配置
2. 查询接口增加 `chain` 参数，默认值 `bsc`，支持 `bsc` / `base`
3. BscScan 跳转链接根据链动态切换（Base 链跳 Basescan）
4. 前端增加链选择器（下拉或 Tab），默认选中 BSC
5. 失败原因分析逻辑复用，无需单独适配

**Base 链 RPC 节点：**

| 节点 | 地址 |
|------|------|
| 主节点 | https://mainnet.base.org |
| 备用节点 | https://base.drpc.org |

**区块浏览器：**

| 链 | 地址 |
|----|------|
| BSC | https://bscscan.com/tx/:txHash |
| Base | https://basescan.org/tx/:txHash |

## 接口变更

### 变更前

```
GET /api/v1/tx/:txHash
```

### 变更后

```
GET /api/v2/tx/:txHash?chain=bsc
```

**新增查询参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| chain | String | 否 | bsc | 链标识，支持 bsc / base |

**返回值新增字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| chain | String | 查询的链标识，如 "bsc" / "base" |
| chainName | String | 链展示名称，如 "BSC" / "Base" |
| explorerUrl | String | 对应链的区块浏览器链接 |

**环境变量新增（backend/.env）：**

```env
BASE_RPC_PRIMARY=https://mainnet.base.org
BASE_RPC_FALLBACK=https://base.drpc.org
```

## 验收标准

- [ ] 输入 Base 链 TxHash + chain=base，返回正确交易详情
- [ ] explorerUrl 指向 Basescan
- [ ] chain 参数缺失时默认查 BSC，向下兼容
- [ ] 主节点失败自动切换备用节点
- [ ] 前端链选择器切换正常
- [ ] 单元测试覆盖 Base 链查询逻辑

## 备注

v1 接口继续保留，v2 新增，不做 breaking change。
