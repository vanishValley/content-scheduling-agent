# 缺资料场景的首次真实模型记录

这份记录来自 kimi-k2.6 的首次完整评估，使用当时的提示词和工具描述。`check_rules` 返回 `missing`，模型仍查询时段并尝试保存；工具用 `REVIEW_REQUIRED` 拒绝，最终没有草稿。

原评估只看最终状态，把 `needs_input` 计为通过。后续增加 `auditRun`，会识别第 4 步的违规保存尝试，因此本记录应视为模型行为未达预期。

这份输入、输出和 Trace 保留原样，作为回归用例。修订后的提示词明确区分 `passed`、`missing` 和 `blocked`；最终评估使用 `examples/live/`，不覆盖这条历史记录。
