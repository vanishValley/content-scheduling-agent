# 验证结果

## 如何复现

在项目根目录运行：

```powershell
node scripts/run-tests.js
node scripts/evaluate.js --provider mock
node scripts/verify-evidence.js
```

本次测试为 29 项通过、0 项失败。离线评估与真实模型评估分别保存在 [mock/summary.json](../examples/mock/summary.json)和 [live/summary.json](../examples/live/summary.json)。测试报告见 [TAP 原始记录](../examples/test-results/node-test.tap)和[摘要](../examples/test-results/summary.json)。重复提交用例实际运行两次，并共享同一草稿存储。

最终离线评估 12/12、真实模型评估 12/12 达到预期。真实评估共执行 13 次任务、56 轮模型动作；其中工具失败和执行上限场景按预期返回未完成。

“达到预期”包含正确拒绝和明确失败，例如保存工具故障时，预期就是 `incomplete`。不能把该指标解释为业务请求全部成功。

## 真实模型用例与实际输出

| 用例 | 预期 / 实际状态 | 草稿数 | 记录 |
| --- | --- | --- | --- |
| 正常排期 | `completed` | 1 | [normal](../examples/live/normal/run-1.json) |
| 信息缺失 | `needs_input` | 0 | [missing](../examples/live/missing/run-1.json) |
| 规则风险 | `blocked` | 0 | [risk](../examples/live/risk/run-1.json) |
| 时段冲突 | `needs_confirmation` | 1 | [conflict](../examples/live/conflict/run-1.json) |
| 重复提交 | 两次均 `completed`；第二次保存为 `duplicate` | 1 | [首次](../examples/live/duplicate/run-1.json)、[再次](../examples/live/duplicate/run-2.json) |
| 保存失败 | `incomplete`，`save_status: failed` | 0 | [save-failure](../examples/live/save-failure/run-1.json) |
| 读取失败 | `incomplete` | 0 | [read-failure](../examples/live/read-failure/run-1.json) |
| 有资料可补查 | `completed`，读取两次后审核一次 | 1 | [supplement](../examples/live/supplement/run-1.json) |
| 更换占用时段 | `completed`，使用原要求 18:00 | 1 | [changed-occupancy](../examples/live/changed-occupancy/run-1.json) |
| 用户批准改期 | `completed`，19:00 为有效草稿时间 | 1 | [confirmed-change](../examples/live/confirmed-change/run-1.json) |
| 无可用时段 | `incomplete` | 0 | [no-slots](../examples/live/no-slots/run-1.json) |
| 执行上限 | `incomplete / STEP_LIMIT` | 0 | [step-limit](../examples/live/step-limit/run-1.json) |

每个目录还保存 `input.json`、`trace-1.jsonl` 和 `drafts.json`。重复用例另有第二次输出与 Trace。`verify-evidence.js` 会核对 Trace 是否与输出一致、声称保存的草稿是否存在，以及未经确认的改期是否仍保持待确认。

## 决策路径如何核对

对比 [正常 Trace](../examples/live/normal/trace-1.jsonl)与[冲突 Trace](../examples/live/conflict/trace-1.jsonl)：前者在查询到 19:00 空闲后保存原时段，后者观察到 18:00 占用后保存 19:00 建议。冲突草稿仍保存 `requested_slot: 18:00`，`effective_slot` 为空。

再对比 [missing](../examples/live/missing/trace-1.jsonl)与 [supplement](../examples/live/supplement/trace-1.jsonl)：前者没有补充资料，结束并请求补全；后者在第一次读取发现有补充资料后，先重新读取，再审核和保存。模型没有机械复现离线策略的两次审核顺序。

上述记录的 `provider.kind` 为 `live`，每步保留模型响应 ID、所选动作、参数、工具结果及简短依据。模型观察到不同工具结果后选择了不同路径。`examples/mock/` 另保留同组离线记录，只用于验证程序流程。

## 真实模型验证状态

真实调用使用 `https://api.moonshot.cn/v1`、`kimi-k2.6`、`thinking: disabled`、`AGENT_TIMEOUT_MS=30000`，只发送合成资料。服务配置、时间、每轮响应 ID 和用量保存在运行记录中；凭据不写入仓库。

联调曾遇到网络限制与旧模型名 404。历史探测分别保存在 [live-probe](../examples/live-probe/normal/run-1.json)和 [live-smoke](../examples/live-smoke/normal/run-1.json)，不计入最终评估。获得用户授权后，查询服务模型列表，改用实际可用模型继续验证。

首次真实评估中，M02 的最终状态正确，但模型曾把“缺少 rights、风险为空”误读为通过，并尝试保存。工具拒绝了写入。原始记录保存在 [回归样例](../examples/regressions/missing-before-clarification/run-1.json)，不列为模型行为通过。

修改提示词与工具描述，明确只有 `audit_status: passed` 才能继续保存；同时增加行为核对，未经审核通过的保存尝试会使该用例评估失败。修订后的 [M02 Trace](../examples/live/missing/trace-1.jsonl)在发现缺资料后直接结束，请求补充版权信息。

## 测试发现并修正的问题

第一次测试中，25 项通过、1 项失败：模型的 `finish.reason` 被直接用作最终文案。即使保存失败，模型也可能写出“已全部发布且保存成功”。

修正后，模型结束依据只保留在 Trace，最终 `reason` 和状态按真实工具记录生成。同一条反例重跑通过，完整测试也通过。这个修改限制了模型能影响的结果范围，避免文案掩盖实际失败。

最后核对还补充了真实写盘异常用例。即使存储函数抛出异常，输出也必须为 `save_status: failed`，不能停留在“未尝试”。步骤上限夹具也带上了运行参数，使用 CLI 直接读取同一输入文件即可复现。

复核重复提交时，新增测试让同一请求首次选择 19:00、再次选择 20:00。旧实现把建议时段算入草稿 ID，测试发现生成了两份草稿。修改后按原始请求去重，并返回首次保存的实际时间；该测试通过，草稿数保持 1。

## 证据的限制

每组最终真实用例只跑一轮，重复提交场景跑两次。样本规模不足以估计线上成功率；提示词改进后的单轮通过也不代表模型永远遵守规则。保留工具侧限制仍有必要。工具故障来自显式注入，不包含磁盘断电或进程崩溃恢复。规则审核是字段与词项检查，不证明素材合法合规。
