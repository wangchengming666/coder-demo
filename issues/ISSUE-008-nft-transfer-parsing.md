# ISSUE-008 NFT 转账解析（ERC-721 / ERC-1155）

**状态：** 待开发  
**优先级：** P2  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

NFT 交易（买卖、铸造、转移）是链上高频操作，当前接口无法展示 NFT 转移信息，需补充支持。

## 需求描述

解析交易 Log 中的 ERC-721 Transfer 和 ERC-1155 TransferSingle/TransferBatch 事件。

**ERC-721 Transfer 事件签名：**
`Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`
topic[0]: `0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef`

**ERC-1155 TransferSingle 事件签名：**
`TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)`
topic[0]: `0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62`

**新增返回字段（data.nftTransfers，数组）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| nftTransfers | Array | NFT 转账列表 |
| nftTransfers[].contractAddress | String | NFT 合约地址 |
| nftTransfers[].standard | String | "ERC-721" 或 "ERC-1155" |
| nftTransfers[].from | String | 转出地址 |
| nftTransfers[].to | String | 转入地址 |
| nftTransfers[].tokenId | String | Token ID |
| nftTransfers[].amount | Number | 数量（ERC-1155 专有，ERC-721 固定为 1） |

## 验收标准

- [ ] ERC-721 Transfer 事件正确解析
- [ ] ERC-1155 TransferSingle 正确解析
- [ ] ERC-1155 TransferBatch 正确解析（拆分为多条记录）
- [ ] standard 字段正确区分 ERC-721 / ERC-1155
- [ ] 无 NFT 转账时返回空数组 `[]`
