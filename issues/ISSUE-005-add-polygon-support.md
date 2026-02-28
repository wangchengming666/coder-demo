# ISSUE-005 接入 Polygon 主网

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

Polygon 是用户量大、Gas 费低的 EVM 链，GameFi 和 NFT 场景活跃，接入后可覆盖大量 Polygon 用户。

## 需求描述

新增 Polygon 主网支持，chain 参数值为 `polygon`。

**RPC 节点：**

| 节点 | 地址 |
|------|------|
| 主节点 | https://polygon-rpc.com |
| 备用节点 | https://rpc.ankr.com/polygon |

**区块浏览器：** https://polygonscan.com/tx/:txHash

**原生代币：** MATIC（decimals: 18）

**特殊说明：**
- Polygon 支持 EIP-1559，Gas 费用结构同 ETH
- 原生代币为 MATIC，valueSymbol 需正确返回 "MATIC"

**新增返回字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| chain | String | "polygon" |
| chainName | String | "Polygon" |
| baseFee | String | 基础费用（Gwei），EIP-1559 交易专有 |
| maxPriorityFee | String | 最大优先费（Gwei），EIP-1559 交易专有 |

## 验收标准

- [ ] chain=polygon 可正确查询 Polygon 交易
- [ ] valueSymbol 返回 "MATIC"
- [ ] explorerUrl 指向 Polygonscan
- [ ] 主备节点容错正常
