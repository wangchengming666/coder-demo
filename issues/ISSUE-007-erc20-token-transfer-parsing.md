# ISSUE-007 ERC-20 代币转账解析

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

大多数链上交易是 ERC-20 代币转账，而非原生代币转账。当前接口只返回原生代币金额（如 BNB/ETH），无法展示 USDT、USDC 等代币的实际转账信息，用户体验差。

## 需求描述

解析交易 Log 中的 ERC-20 Transfer 事件，返回代币转账详情。

**解析逻辑：**
- 扫描 receipt.logs
- 找到 topic[0] == `keccak256("Transfer(address,address,uint256)")`（即 `0xddf252ad...`）
- 解码 from / to / value
- 调用代币合约获取 symbol / decimals

**新增返回字段（data.tokenTransfers，数组）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| tokenTransfers | Array | ERC-20 转账列表 |
| tokenTransfers[].contractAddress | String | 代币合约地址 |
| tokenTransfers[].from | String | 转出地址 |
| tokenTransfers[].to | String | 转入地址 |
| tokenTransfers[].value | String | 转账金额（格式化后，含小数） |
| tokenTransfers[].valueRaw | String | 原始金额（wei） |
| tokenTransfers[].symbol | String | 代币符号，如 "USDT" |
| tokenTransfers[].decimals | Number | 代币精度 |

**响应示例：**
```json
{
  "tokenTransfers": [
    {
      "contractAddress": "0x55d398326f99059fF775485246999027B3197955",
      "from": "0xSender...",
      "to": "0xReceiver...",
      "value": "100.00",
      "valueRaw": "100000000000000000000",
      "symbol": "USDT",
      "decimals": 18
    }
  ]
}
```

## 验收标准

- [ ] 含 ERC-20 Transfer 事件的交易正确解析并返回 tokenTransfers
- [ ] 多笔转账（如聚合器交易）全部返回
- [ ] symbol / decimals 通过合约调用获取，缓存 5 分钟以减少 RPC 调用
- [ ] 无 ERC-20 转账时返回空数组 `[]`
