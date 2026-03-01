# ISSUE-011 Gas 费用对比（vs 网络均价）

**状态：** 待开发  
**优先级：** P2  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

用户在查询交易时，常常不知道自己支付的 Gas 费是高是低。增加与网络均价的对比，帮助用户判断是否超额支付 Gas。

## 需求描述

在交易查询结果中新增 Gas 费用对比字段，展示该交易 Gas Price 与当时区块平均 Gas Price 的对比。

**实现逻辑：**
1. 获取该交易所在区块的所有交易 gasPrice
2. 计算区块平均 gasPrice
3. 对比该交易的 gasPrice，计算差异百分比

**新增返回字段（data.gasAnalysis）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| gasAnalysis | Object | Gas 分析对象 |
| gasAnalysis.txGasPrice | String | 该交易 Gas Price（Gwei） |
| gasAnalysis.blockAvgGasPrice | String | 所在区块平均 Gas Price（Gwei） |
| gasAnalysis.diff | String | 差异百分比，如 "+12.5%" 或 "-5.3%" |
| gasAnalysis.level | String | 评级：low / normal / high |

**评级规则：**

| 评级 | 条件 |
|------|------|
| low | 低于均价 20% 以上 |
| normal | 在均价 ±20% 以内 |
| high | 高于均价 20% 以上 |

**响应示例：**
```json
{
  "gasAnalysis": {
    "txGasPrice": "5.2",
    "blockAvgGasPrice": "4.5",
    "diff": "+15.6%",
    "level": "normal"
  }
}
```

## 验收标准

- [ ] gasAnalysis 字段正确返回
- [ ] diff 计算准确
- [ ] level 按规则正确评级
- [ ] PENDING 交易不返回 gasAnalysis（区块数据不存在）
