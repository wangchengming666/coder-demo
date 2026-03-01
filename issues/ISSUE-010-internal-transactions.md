# ISSUE-010 内部交易（Internal Transactions）

**状态：** 待开发  
**优先级：** P2  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

合约调用合约时产生的 ETH/BNB 转移（internal tx）不在 receipt 中体现，当前接口无法展示。用户在排查合约间资金流向时需要此信息。

## 需求描述

通过 `debug_traceTransaction` RPC 方法获取内部交易列表。

**新增返回字段（data.internalTxs，数组）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| internalTxs | Array | 内部交易列表 |
| internalTxs[].type | String | 调用类型：CALL / DELEGATECALL / CREATE |
| internalTxs[].from | String | 调用方地址 |
| internalTxs[].to | String | 被调用方地址 |
| internalTxs[].value | String | 转移原生代币金额 |
| internalTxs[].valueRaw | String | 原始金额（wei） |
| internalTxs[].gas | String | 分配 Gas |
| internalTxs[].gasUsed | String | 实际消耗 Gas |
| internalTxs[].success | Boolean | 该内部调用是否成功 |
| internalTxs[].error | String | 失败原因（如有） |

**注意：**
- 部分 RPC 节点不支持 `debug_traceTransaction`，需在节点配置中标记是否支持
- 不支持时该字段返回 `null`，并在响应中附带 `debugUnsupported: true`

## 验收标准

- [ ] 支持 debug 的节点正确返回内部交易列表
- [ ] value=0 的内部调用也需返回（如纯逻辑调用）
- [ ] 不支持 debug 的节点返回 null + debugUnsupported: true
- [ ] 嵌套调用正确展开为平铺列表
