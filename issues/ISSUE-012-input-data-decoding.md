# ISSUE-012 合约方法解码（Input Data 可读化）

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

当前 inputData 字段只返回原始十六进制数据，普通用户完全看不懂。通过 4byte.directory 等公共 ABI 数据库，可以将 function selector 解码为可读的方法名和参数。

## 需求描述

对 inputData 前 4 字节（function selector）进行解码，返回方法名和参数列表。

**实现逻辑：**
1. 取 inputData 前 4 字节（8 位十六进制）作为 function selector
2. 查询 https://www.4byte.directory/api/v1/signatures/?hex_signature=<selector>
3. 解码参数并格式化返回

**新增返回字段（data.methodInfo）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| methodInfo | Object | 方法解码结果 |
| methodInfo.selector | String | 4字节 selector，如 "0xa9059cbb" |
| methodInfo.name | String | 方法名，如 "transfer" |
| methodInfo.signature | String | 完整签名，如 "transfer(address,uint256)" |
| methodInfo.params | Array | 参数列表 [{name, type, value}] |
| methodInfo.decoded | Boolean | 是否成功解码 |

**响应示例：**
```json
{
  "methodInfo": {
    "selector": "0xa9059cbb",
    "name": "transfer",
    "signature": "transfer(address,uint256)",
    "decoded": true,
    "params": [
      { "name": "_to", "type": "address", "value": "0xReceiver..." },
      { "name": "_value", "type": "uint256", "value": "1000000000000000000" }
    ]
  }
}
```

**边界情况：**
- inputData 为 "0x"（原生转账）时，methodInfo 返回 null
- 4byte 查不到时，decoded=false，只返回 selector

## 验收标准

- [ ] 常见方法（transfer/approve/swap）正确解码
- [ ] inputData 为 0x 时返回 null
- [ ] 4byte 查不到时 decoded=false 并返回原始 selector
- [ ] 4byte 接口调用失败时不影响主接口返回（降级处理）
