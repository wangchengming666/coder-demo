# ISSUE-004 接入 Arbitrum One

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

Arbitrum One 是目前 TVL 最高的 ETH L2，DeFi 用户活跃，交易量大，接入后可覆盖大量 L2 用户。

## 需求描述

新增 Arbitrum One 支持，chain 参数值为 `arb`。

**RPC 节点：**

| 节点 | 地址 |
|------|------|
| 主节点 | https://arb1.arbitrum.io/rpc |
| 备用节点 | https://rpc.ankr.com/arbitrum |

**区块浏览器：** https://arbiscan.io/tx/:txHash

**原生代币：** ETH（decimals: 18）

**特殊说明：**
- Arbitrum 使用 ArbGas 机制，Gas 费用由 L1 calldata 费用 + L2 执行费用组成
- 需新增 `l1Fee` 字段，展示支付给 L1 的费用部分

**新增返回字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| chain | String | "arb" |
| chainName | String | "Arbitrum One" |
| l1Fee | String | 支付给 L1 的费用（ETH），Arbitrum 专有 |
| l1FeeRaw | String | l1Fee 原始值（wei） |

## 验收标准

- [ ] chain=arb 可正确查询 Arbitrum 交易
- [ ] l1Fee 字段正确返回（非 Arbitrum 链不返回此字段）
- [ ] explorerUrl 指向 Arbiscan
- [ ] 主备节点容错正常
