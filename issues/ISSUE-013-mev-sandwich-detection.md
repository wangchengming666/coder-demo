# ISSUE-013 MEV / 夹子攻击检测

**状态：** 待开发  
**优先级：** P2  
**提出人：** Vault (PM)  
**日期：** 2026-02-28  

## 背景

MEV（最大可提取价值）中的夹子攻击（Sandwich Attack）会导致用户交易以更差的价格成交，损害用户利益。在交易详情中标注是否疑似遭受夹子攻击，帮助用户感知链上风险。

## 需求描述

通过分析同区块前后交易，检测目标交易是否疑似遭受夹子攻击。

**检测逻辑：**
1. 获取目标交易所在区块的所有交易（`eth_getBlockByNumber`）
2. 在目标交易的前后各找同一交易对的 Swap 交易
3. 若前置交易（front-run）和后置交易（back-run）来自同一地址或关联地址，且方向相反，则标记为疑似夹子攻击

**新增返回字段（data.mevInfo）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| mevInfo | Object | MEV 分析结果 |
| mevInfo.isSuspicious | Boolean | 是否疑似遭受 MEV 攻击 |
| mevInfo.attackType | String | 攻击类型："sandwich" / "frontrun" / null |
| mevInfo.frontRunTx | String | 疑似前置交易 TxHash |
| mevInfo.backRunTx | String | 疑似后置交易 TxHash |
| mevInfo.estimatedLoss | String | 估算损失（可选，金额单位与 tokenOut 一致） |
| mevInfo.confidence | String | 置信度："high" / "medium" / "low" |

**响应示例：**
```json
{
  "mevInfo": {
    "isSuspicious": true,
    "attackType": "sandwich",
    "frontRunTx": "0xaaa...",
    "backRunTx": "0xbbb...",
    "estimatedLoss": "2.31 USDT",
    "confidence": "high"
  }
}
```

**注意：**
- 该检测为启发式算法，存在误判，需在前端明确标注"仅供参考"
- 非 Swap 交易直接返回 `mevInfo: null`
- 此功能计算量较大，建议异步返回或单独接口

## 验收标准

- [ ] 已知夹子攻击交易能被正确识别
- [ ] 非 Swap 交易返回 null
- [ ] confidence 字段准确反映检测置信度
- [ ] 检测失败时不影响主接口返回（降级处理）
- [ ] 前端展示"仅供参考"免责说明
