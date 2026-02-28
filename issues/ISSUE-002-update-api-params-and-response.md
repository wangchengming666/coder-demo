# ISSUE-002 修改接口参数与返回值

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

v1 接口返回值存在以下问题：
1. `code` 字段语义不清晰（200 表示成功但又有 200/400/404/500 混用）
2. 缺少请求唯一标识，难以排查问题
3. `valueRaw` 字段单位说明缺失，前端处理容易出错
4. 时区信息未在字段中体现，`datetime` 依赖文档说明

## 需求描述

对查询接口进行结构优化，升级为 v2，提升可读性和可维护性。

## 接口变更

### 变更前（v1）

```
GET /api/v1/tx/:txHash
```

**响应结构：**
```json
{
  "code": 200,
  "message": "success",
  "data": {
    "txHash": "0x...",
    "status": "SUCCESS",
    "value": "0.0001",
    "valueSymbol": "BNB",
    "valueRaw": "100000000000000",
    "datetime": "2026-02-28 21:51:25"
  }
}
```

### 变更后（v2）

```
GET /api/v2/tx/:txHash?chain=bsc
```

**响应结构：**
```json
{
  "success": true,
  "requestId": "uuid-v4",
  "data": {
    "txHash": "0x...",
    "chain": "bsc",
    "chainName": "BSC",
    "status": "SUCCESS",
    "value": {
      "amount": "0.0001",
      "symbol": "BNB",
      "raw": "100000000000000",
      "decimals": 18
    },
    "datetime": {
      "utc": "2026-02-28T13:51:25Z",
      "local": "2026-02-28 21:51:25",
      "timezone": "Asia/Shanghai",
      "timestamp": 1772267485
    }
  }
}
```

**字段变更说明：**

| 变更类型 | 字段 | 说明 |
|----------|------|------|
| 新增 | success | Boolean，替代 code 字段 |
| 新增 | requestId | 请求唯一 ID（UUID v4），便于排查 |
| 新增 | chain / chainName | 当前查询的链 |
| 改造 | value | 拆分为对象，含 amount / symbol / raw / decimals |
| 改造 | datetime | 拆分为对象，含 utc / local / timezone / timestamp |
| 移除 | code | 用 success + HTTP 状态码替代 |
| 移除 | message | 错误信息移到 error.message |

**错误响应（v2）：**
```json
{
  "success": false,
  "requestId": "uuid-v4",
  "error": {
    "code": "INVALID_TX_HASH",
    "message": "txHash 格式错误，应为 66 位十六进制字符串"
  }
}
```

**错误码枚举：**

| code | HTTP 状态码 | 含义 |
|------|------------|------|
| INVALID_TX_HASH | 400 | txHash 格式错误 |
| TX_NOT_FOUND | 404 | 交易不存在 |
| UNSUPPORTED_CHAIN | 400 | 不支持的链 |
| RPC_ERROR | 502 | RPC 节点异常 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |

## 验收标准

- [ ] v2 接口返回新结构，字段完整
- [ ] v1 接口继续可用，不做 breaking change
- [ ] requestId 每次请求唯一
- [ ] 错误响应使用 error.code 枚举值
- [ ] value.decimals 正确返回（BNB 为 18）
- [ ] datetime.utc 为标准 ISO 8601 格式

## 备注

v1 接口标记为 deprecated，在 v3 版本移除。
