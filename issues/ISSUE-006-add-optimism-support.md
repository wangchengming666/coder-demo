# ISSUE-006 接入 Optimism 主网

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

Optimism 是 Coinbase Base 的底层框架（OP Stack）的原链，与 Base 共用生态，接入后与 Base 形成 Superchain 双链覆盖。

## 需求描述

新增 Optimism 主网支持，chain 参数值为 `op`。

**RPC 节点：**

| 节点 | 地址 |
|------|------|
| 主节点 | https://mainnet.optimism.io |
| 备用节点 | https://rpc.ankr.com/optimism |

**区块浏览器：** https://optimistic.etherscan.io/tx/:txHash

**原生代币：** ETH（decimals: 18）

**特殊说明：**
- Optimism 同样有 L1 Fee 机制（OP Stack），需返回 `l1Fee` 字段
- l1Fee 通过调用 `0x420000000000000000000000000000000000000F` (GasPriceOracle) 合约获取

**新增返回字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| chain | String | "op" |
| chainName | String | "Optimism" |
| l1Fee | String | 支付给 L1 的费用（ETH），OP Stack 专有 |
| l1FeeRaw | String | l1Fee 原始值（wei） |
| l1GasUsed | String | L1 Gas 用量，OP Stack 专有 |

## 验收标准

- [ ] chain=op 可正确查询 Optimism 交易
- [ ] l1Fee 通过 GasPriceOracle 合约正确获取
- [ ] explorerUrl 指向 Optimistic Etherscan
- [ ] 主备节点容错正常
