# ISSUE-015 接口响应新增 requestId 字段

**状态：** 待开发  
**优先级：** P1  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

线上出现问题时，无法快速定位是哪次请求，排查成本高。增加 `requestId` 字段后，前端可在上报日志时携带该 ID，后端日志也同步记录，实现全链路追踪。

## 需求描述

每次请求后端自动生成一个唯一 ID，并在响应中返回。

### 变更前

```json
{
  "success": true,
  "data": { ... }
}
```

### 变更后

```json
{
  "success": true,
  "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "data": { ... }
}
```

**要求：**
- `requestId` 使用 UUID v4 格式
- 无论成功还是失败，所有响应均包含此字段
- 后端日志每条记录同步打印 `requestId`，便于关联查询

## 验收标准

- [ ] 所有接口响应包含 `requestId` 字段
- [ ] 每次请求生成唯一值，不重复
- [ ] 错误响应同样包含 `requestId`
- [ ] 后端日志中可通过 `requestId` 检索到对应请求记录

## 备注

可使用 `uuid` 包（`npm install uuid`），改动仅限 `backend/src/index.js`。预计工作量 **2 小时**。
