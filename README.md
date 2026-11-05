# 素材审核与发布排期 Agent

校招考核第 1 题。输入素材 ID 和期望时间，Agent 读取资料、核对规则、查询时段，再保存排期草稿。遇到资料缺失、风险或冲突时，它会依据工具结果选择补查、建议改期或结束。

项目只保存草稿。`completed` 表示草稿处理完成，所有草稿的 `published` 都是 `false`。

已保留 29 项测试报告、12 组离线评估和 12 组 kimi-k2.6 真实模型评估。真实记录包含首次误判及提示词修订后的结果，见 [验证结果](docs/03-evaluation.md)。

## 评审从哪里看

- [需求与验收标准](docs/01-requirements.md)：业务边界、输入输出和六项必验场景。
- [实现与文件说明](docs/02-solution.md)：模型循环、工具职责、确认边界、存储取舍。
- [验证结果](docs/03-evaluation.md)：实际执行结果及对应 Trace。
- [AI 使用记录](docs/04-ai-usage.md)：本次辅助范围及候选人需要自己补全的内容。
- [复盘](docs/05-retrospective.md)：测试发现的问题和后续工作。
- [四题选题说明](docs/topics/00-comparison.md)：四题比较；每题均有单独的实现方案和文件说明。第 2 至第 4 题没有冒充已完成项目。
- [提交说明](SUBMISSION.md)：题号、commit 获取方式、GitHub 提交步骤。

## 环境和安装

已验证环境：Node.js 22.18.0、Windows PowerShell。项目使用 Node 内置的文件、HTTP、测试模块，没有第三方运行依赖，也没有使用 Agent 框架。安装 Node.js 后，在仓库根目录执行下面的命令即可，无须 `npm install`。

```powershell
node --version
npm test
npm run evaluate
npm run verify
```

离线模式无需环境变量。`MockProvider` 是条件策略替身，用来验证工具、状态和错误处理；离线通过不证明真实模型的决策效果。

## 单次运行

```powershell
node src/cli.js --input examples/inputs/normal.json --provider mock --store .runtime/demo --output .runtime/demo-output.json
node src/cli.js --input examples/inputs/conflict.json --provider mock --store .runtime/conflict --output .runtime/conflict-output.json
```

相同请求重复运行时使用同一 `--store`，才能检验去重。评估脚本每次创建独立目录，避免上次运行影响结果；只有 `duplicate` 用例的两次运行共享存储。

输入文件中的 `request` 是业务请求。`world_overrides`、`faults` 是演示用夹具，分别替换合成环境和注入工具故障，不能在生产接口直接开放给用户。`max_steps` 可指定用例的动作上限，命令行 `--max-steps` 优先。

```json
{
  "request": {
    "material_ids": ["M01"],
    "desired_slot": "2026-11-06T18:00:00+08:00",
    "hard_time": true
  }
}
```

所有时间固定使用 `+08:00`，精确到分钟。`hard_time: true` 时，替代时段只能成为待确认建议。用户明确同意后，可以在新请求中填写 `approved_slot`。模型的工具参数不包含批准字段，无法自行确认。

输出 JSON 含 `status`、`reason`、`items`、`trace`。每项素材列出 `audit_status`、`risks`、`missing_fields`、`suggested_slot`、`pending_confirmation`、`save_status` 和 `draft_id`。草稿文件位于 `--store` 目录下的 `drafts.json`。

## 真实模型入口

适配器使用 Chat Completions 的工具调用协议。参考 [Kimi 工具调用文档](https://platform.kimi.com/docs/api/tool-use)。代码只从 `AGENT_*` 变量读取配置，不会自动借用其他软件的凭据。

复制 `.env.example` 为 `.env`，填入自己获准使用的服务地址、模型名和密钥，再执行：

本次联调配置为 `AGENT_MODEL=kimi-k2.6`、`AGENT_THINKING=disabled`。后一个参数按 [Moonshot 官方模型使用说明](https://huggingface.co/moonshotai/Kimi-K2.6#chat-completion)设置；换用其他服务时，若不支持 `thinking`，可将其留空。旧模型名可能已不可用，遇到 404 应先核对该服务的模型列表。

```powershell
node --env-file=.env src/cli.js --provider live --input examples/inputs/conflict.json --store .runtime/live-demo --output .runtime/live-output.json
node --env-file=.env scripts/evaluate.js --provider live
node scripts/verify-evidence.js --root examples/live
```

`AGENT_BASE_URL` 应包含 `/v1`，不要填写完整的 `/chat/completions` 地址。模型需支持函数工具调用；服务不支持、网络失败、没有返回单个有效动作时，任务会明确返回 `incomplete`。程序不会自动切换成 Mock，也不会伪造模型记录。真实模型实测情况见 [评估文档](docs/03-evaluation.md)。

每次最多执行 12 轮模型动作，包含 `finish`；可用 `--max-steps` 调整，范围 1 至 100。达到上限仍未结束时返回 `incomplete / STEP_LIMIT`。单次模型请求默认 60 秒超时，可通过 `AGENT_TIMEOUT_MS` 调整。

CLI 退出码：`0` 表示取得可解释的业务结果，包括需补资料、待确认和阻断；`2` 表示执行未完成；`1` 表示参数、配置或启动错误。调用方须同时读取 JSON 中的业务状态。

## 重跑与核对

```powershell
node scripts/run-tests.js
node scripts/evaluate.js --provider mock
node scripts/verify-evidence.js
```

测试报告保存在 `examples/test-results/`。每组评估保留输入、实际输出、逐步 Trace 和最终草稿列表。可以把 `examples/inputs/changed-occupancy.json` 的占用时段换掉再运行，比较模型收到的新结果及后续动作。

`examples/live/` 是最终真实模型记录；`examples/regressions/` 保留首次缺资料误判。评估除了检查最终状态，也会把未经审核通过的保存尝试计为失败。`examples/live-probe/` 和 `examples/live-smoke/` 是历史连接与旧模型配置失败记录，不计入最终结果。

## 当前限制

审核基于合成元数据与确定规则，没有图片识别、视频理解和法律判断。排期采用“一个时间槽容纳一个素材”的简化模型，没有渠道、账号或发布时长维度。文件存储适合本地演示；进程崩溃留下锁文件时需人工核查。确认改期会生成新草稿，旧建议不会自动归档。

候选人尚未提供个人修改记录、实际投入时间与 GitHub 地址，相关位置已明确留待补充。请按自己的操作补全后提交。
