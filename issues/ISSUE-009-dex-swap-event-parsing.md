# ISSUE-009 DEX 交换事件解析（Swap）

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

DEX Swap 是链上最高频的交易类型之一。当前接口无法直接告知用户"用多少 A 换了多少 B"，需要用户自己解读 Log，体验差。

## 需求描述

解析主流 DEX 的 Swap 事件，返回人类可读的兑换信息。

**支持的 DEX 及事件签名：**

| DEX | 链 | 事件签名 topic[0] |
|-----|-----|------------------|
| PancakeSwap V2 | BSC | `0xd78ad95f...` (Swap) |
| Uniswap V2 | ETH/Polygon | `0xd78ad95f...` (Swap) |
| Uniswap V3 | ETH/Arbitrum/Polygon | `0xc42079f9...` (Swap) |

**新增返回字段（data.swaps，数组）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| swaps | Array | Swap 记录列表 |
| swaps[].dex | String | DEX 名称，如 "PancakeSwap V2" |
| swaps[].poolAddress | String | 交易池合约地址 |
| swaps[].tokenIn | Object | 输入代币 {symbol, amount, contractAddress} |
| swaps[].tokenOut | Object | 输出代币 {symbol, amount, contractAddress} |
| swaps[].priceImpact | String | 价格影响（如 "0.12%"），可选 |

**响应示例：**
```json
{
  "swaps": [
    {
      "dex": "PancakeSwap V2",
      "poolAddress": "0x...",
      "tokenIn": { "symbol": "BNB", "amount": "0.5", "contractAddress": null },
      "tokenOut": { "symbol": "USDT", "amount": "149.32", "contractAddress": "0x55d3..." }
    }
  ]
}
```

## 验收标准

- [ ] PancakeSwap V2 Swap 事件正确解析
- [ ] Uniswap V2/V3 Swap 事件正确解析
- [ ] 多跳路由（Multi-hop）拆分为多条 swap 记录
- [ ] 非 Swap 交易返回空数组 `[]`
