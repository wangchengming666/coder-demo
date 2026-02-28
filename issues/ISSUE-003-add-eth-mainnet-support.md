# ISSUE-003 接入 Ethereum 主网

**状态：** 待开发  
**优先级：** P0  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

Ethereum 主网是使用量最大的 EVM 链，用户基数庞大，接入后可覆盖大量 ETH 用户的交易查询需求。

## 需求描述

新增 Ethereum 主网支持，chain 参数值为 `eth`。

**RPC 节点：**

| 节点 | 地址 |
|------|------|
| 主节点 | https://eth.llamarpc.com |
| 备用节点 | https://rpc.ankr.com/eth |

**区块浏览器：** https://etherscan.io/tx/:txHash

**原生代币：** ETH（decimals: 18）

**特殊说明：**
- ETH 网络 Gas 费用以 Gwei 计，但 baseFee + priorityFee（EIP-1559）结构与 BSC 不同，需适配
- 返回值需新增 `baseFee` 和 `maxPriorityFee` 字段（EIP-1559 交易）

**新增返回字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| chain | String | "eth" |
| chainName | String | "Ethereum" |
| baseFee | String | 基础费用（Gwei），EIP-1559 交易专有 |
| maxPriorityFee | String | 最大优先费（Gwei），EIP-1559 交易专有 |
| txType | Number | 交易类型：0=Legacy, 1=EIP-2930, 2=EIP-1559 |

## 验收标准

- [ ] chain=eth 可正确查询 ETH 主网交易
- [ ] EIP-1559 交易正确返回 baseFee / maxPriorityFee
- [ ] Legacy 交易（type=0）正常处理
- [ ] explorerUrl 指向 Etherscan
- [ ] 主备节点容错正常
