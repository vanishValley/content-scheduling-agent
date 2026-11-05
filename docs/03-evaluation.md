# 验证结果

## 如何复现

在项目根目录运行：

```powershell
node scripts/run-tests.js
node scripts/evaluate.js --provider mock
node scripts/verify-evidence.js
```

本次测试为 28 项通过、0 项失败。离线评估 12 组用例全部达到各自的预期状态，其中重复提交实际运行两次。测试报告见 [TAP 原始记录](../examples/test-results/node-test.tap)和[摘要](../examples/test-results/summary.json)，评估汇总见 [mock/summary.json](../examples/mock/summary.json)。

“达到预期”包含正确拒绝和明确失败，例如保存工具故障时，预期就是 `incomplete`。不能把该指标解释为业务请求全部成功。

## 用例与实际输出

| 用例 | 预期 / 实际状态 | 草稿数 | 记录 |
| --- | --- | --- | --- |
| 正常排期 | `completed` | 1 | [normal](../examples/mock/normal/run-1.json) |
| 信息缺失 | `needs_input` | 0 | [missing](../examples/mock/missing/run-1.json) |
| 规则风险 | `blocked` | 0 | [risk](../examples/mock/risk/run-1.json) |
| 时段冲突 | `needs_confirmation` | 1 | [conflict](../examples/mock/conflict/run-1.json) |
| 重复提交 | 两次均 `completed`；第二次保存为 `duplicate` | 1 | [首次](../examples/mock/duplicate/run-1.json)、[再次](../examples/mock/duplicate/run-2.json) |
| 保存失败 | `incomplete`，`save_status: failed` | 0 | [save-failure](../examples/mock/save-failure/run-1.json) |
| 读取失败 | `incomplete` | 0 | [read-failure](../examples/mock/read-failure/run-1.json) |
| 有资料可补查 | `completed`，读取和审核各两次 | 1 | [supplement](../examples/mock/supplement/run-1.json) |
| 更换占用时段 | `completed`，使用原要求 18:00 | 1 | [changed-occupancy](../examples/mock/changed-occupancy/run-1.json) |
| 用户批准改期 | `completed`，19:00 为有效草稿时间 | 1 | [confirmed-change](../examples/mock/confirmed-change/run-1.json) |
| 无可用时段 | `incomplete` | 0 | [no-slots](../examples/mock/no-slots/run-1.json) |
| 执行上限 | `incomplete / STEP_LIMIT` | 0 | [step-limit](../examples/mock/step-limit/run-1.json) |

每个目录还保存 `input.json`、`trace-1.jsonl` 和 `drafts.json`。重复用例另有第二次输出与 Trace。`verify-evidence.js` 会核对 Trace 是否与输出一致、声称保存的草稿是否存在，以及未经确认的改期是否仍保持待确认。

## 决策路径如何核对

对比 [正常 Trace](../examples/mock/normal/trace-1.jsonl)与[冲突 Trace](../examples/mock/conflict/trace-1.jsonl)：前者在查询到 19:00 空闲后保存原时段，后者观察到 18:00 占用后保存 19:00 建议。冲突草稿仍保存 `requested_slot: 18:00`，`effective_slot` 为空。

再对比 [missing](../examples/mock/missing/trace-1.jsonl)与 [supplement](../examples/mock/supplement/trace-1.jsonl)：前者没有补充资料，结束并请求补全；后者在发现现有补充资料后重新读取、审核，再保存。

这些是实际执行的离线工具记录，证明了状态变化和工具约束。它们由离线策略产生，不能作为真实模型自适应决策的证据。

## 真实模型验证状态

当前没有真实模型成功完成的运行记录。已进行一次真实模式连接尝试，记录见 [live-probe/normal/run-1.json](../examples/live-probe/normal/run-1.json)，在第 1 轮返回 `MODEL_NETWORK_ERROR`，未执行业务工具、未保存草稿。

随后申请连接现有环境所指向的 Moonshot 服务，自动审批拒绝发送认证凭据，理由是缺少用户对该具体目的地的明确授权。没有通过其他方式绕过。该失败探测单独保留，不计入 12 组离线通过用例。

真实适配器代码和观察回传测试已完成；真实模型的动作质量、工具选择是否稳定仍未验证。按题目的 ReAct 要求，目前不能把离线 Trace 宣称为真实模型决策验收通过。

取得获准使用的模型配置后，执行 README 中的真实评估命令。至少核对正常与冲突两条路径，再覆盖缺资料、风险、重复和保存失败；生成的 `examples/live/` 必须与本节一并更新。

## 测试发现并修正的问题

第一次测试中，25 项通过、1 项失败：模型的 `finish.reason` 被直接用作最终文案。即使保存失败，模型也可能写出“已全部发布且保存成功”。

修正后，模型结束依据只保留在 Trace，最终 `reason` 和状态按真实工具记录生成。同一条反例重跑通过，完整测试也通过。这个修改限制了模型能影响的结果范围，避免文案掩盖实际失败。

最后核对还补充了真实写盘异常用例。即使存储函数抛出异常，输出也必须为 `save_status: failed`，不能停留在“未尝试”。步骤上限夹具也带上了运行参数，使用 CLI 直接读取同一输入文件即可复现。

复核重复提交时，新增测试让同一请求首次选择 19:00、再次选择 20:00。旧实现把建议时段算入草稿 ID，测试发现生成了两份草稿。修改后按原始请求去重，并返回首次保存的实际时间；该测试通过，草稿数保持 1。

## 证据的限制

当前用例规模小，离线策略有确定行为；不能据此推算线上成功率。工具故障来自显式注入，不包含磁盘断电、真实网络分区或进程崩溃恢复。规则审核是字段与词项检查，不证明素材合法合规。
