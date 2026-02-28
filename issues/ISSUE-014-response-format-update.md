# ISSUE-014 统一接口返回值格式

**状态：** 待开发  
**优先级：** P0  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

当前 `/api/v1/tx/:txHash` 接口成功时返回 `code: 200`，失败时也可能返回 `code: 200` 但 data 为空，语义混乱，前端处理容易出错。需统一返回格式。

## 需求描述

调整接口返回值结构，所有响应统一使用以下格式：

### 成功响应

```json
{
  "success": true,
  "data": { ... }
}
```

### 失败响应

```json
{
  "success": false,
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
| RPC_ERROR | 502 | RPC 节点异常 |
| INTERNAL_ERROR | 500 | 服务器内部错误 |

## 验收标准

- [ ] 所有成功响应包含 `success: true` + `data`
- [ ] 所有失败响应包含 `success: false` + `error.code` + `error.message`
- [ ] 原有 `code` 字段移除
- [ ] 单元测试更新，覆盖新格式
- [ ] 接口文档同步更新

## 备注

改动仅限 `backend/src/index.js` 返回格式，业务逻辑不变。预计工作量 **0.5 天**。
