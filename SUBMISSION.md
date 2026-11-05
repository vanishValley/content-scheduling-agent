# 提交信息

- 题号：第 1 题，素材审核与发布排期 Agent。
- GitHub URL：[vanishValley/content-scheduling-agent](https://github.com/vanishValley/content-scheduling-agent)。
- 最终 commit SHA：上传前执行 `git rev-parse HEAD`，复制完整结果到交卷栏。
- 真实模型记录：已使用 kimi-k2.6 运行，详见 `examples/live/` 与 `docs/03-evaluation.md`。
- 个人贡献与实际用时：待候选人在 `docs/04-ai-usage.md` 中据实补充。

## 上传步骤

项目使用下列仓库地址。已有 `origin` 时可用 `git remote -v` 核对，无须重复添加。

```powershell
git remote add origin https://github.com/vanishValley/content-scheduling-agent.git
git branch -M main
git push -u origin main
git rev-parse HEAD
```

若后续修改了个人记录或补充真实模型证据，先运行测试与评估，再提交这些修改，最后重新获取 SHA。交卷填写的 SHA 应包含最终材料。

## 评审入口

README 提供运行命令；`docs/` 提供需求、设计、验证、AI 使用和复盘；`examples/` 存放实际记录。第 2 至第 4 题仅作为选题分析附录，不能填写为已完成题目。

提交前检查仓库不含 `.env`、真实密钥或隐私素材。若使用私有仓库，按试卷要求为指定评审账号开通读取权限。
