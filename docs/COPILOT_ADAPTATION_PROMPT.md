# Copilot 自动适配 Prompt 模板

使用方法：将本模板仓库与目标 React 业务仓、独立 CICD 仓同时挂载到 Copilot Desktop 或 Copilot CLI：

```bash
cd /path/to/your-react-app
copilot --add-dir ../react-copilot-jenkins-blueprint --add-dir ../your-cicd-repo
```

---

## Prompt 1：双仓扫描与差异分析（先规划，不直接修改）

```text
请先阅读参考模板仓库 `../react-copilot-jenkins-blueprint` 的以下文件：
- README.md
- docs/MIGRATION_GUIDE.md
- frontend-app/.github/workflows/pr-gate.yml & trigger-cicd.yml
- frontend-app/.github/copilot-instructions.md
- frontend-cicd/config/branch-env-map.json
- frontend-cicd/scripts/jenkins-orchestrator.mjs & jenkins-inspect.mjs
- frontend-cicd/.github/workflows/jenkins-3stage-orchestrator.yml
- frontend-cicd/.github/workflows/jenkins-callback-orchestrator.yml
- frontend-cicd/.github/workflows/release-train.yml
- frontend-cicd/snippets/jenkins-callback.groovy

然后分析当前 React 业务仓和 `../your-cicd-repo`：
1. 识别现有的包管理器、Node 版本、oxlint/eslint/commitlint/vitest/ggshield 配置；
2. 识别 `../your-cicd-repo` 中已有的 Jenkinsfile、环境列表（如 env1-env5, sim）和 3 个 Jenkins Job 的真实路径与参数名（dev 下的 CI/Release、uat 下的 CD）；
3. 判断 `../your-cicd-repo` 中的 Jenkinsfile 是否允许添加 `post` 回调（决定采用零轮询 Push 回调模式，还是零侵入轮询模式）；
4. 严格遵守以下架构约束：
   - 单点 PR 门禁：本地 pre-commit 仅保留 <1s 的 ggshield；oxlint/eslint、commit message 校验、PR 级 vitest related（改全局配置兜底全量）统一在 GHES PR Gate 执行一遍，不跑 build；
   - 无 Jenkins 管理员权限，不依赖新增 Jenkins 插件；
   - 未开启 Copilot MCP，使用仓库内只读 CLI 脚本（jenkins-inspect.mjs）供 Copilot 排障；
   - 凭据隔离：Jenkins Token 与 Teams Webhook 仅存于 CICD 仓库 Secrets；
   - 适配长耗时流水线（CI ~15m、Release ~25m、CD ~7m）：支持按需标签/`/deploy` 或定时班车合批防过载，保留占坑避让、断点续跑与 Teams 告警卡片。

请输出《差异对照表 + 推荐模式选型 + 改造实施清单》，列出需要确认的真实 Job 名、参数名和变量名，等我确认后再修改文件。
```

---

## Prompt 2：落地 React 业务仓改造（Phase 1）

```text
按刚才确认的方案，在当前 React 业务仓库创建分支 `chore/setup-pr-gate-and-copilot-workflow` 并完成改造：
1. 精简本地 pre-commit hook 仅保留 ggshield；
2. 生成 `.github/workflows/pr-gate.yml`（匹配真实包管理器与脚本，无 build，PR 级 vitest related）；
3. 生成 `.github/workflows/trigger-cicd.yml`（支持 opt-in 标签与 `/deploy` 评论触发，零 Jenkins 凭据）；
4. 生成 `.github/copilot-instructions.md` 和 `.github/skills/ship-pr/SKILL.md`；
5. 运行本地 lint 和相关单测验证配置无误后，展示 diff 供审核。
```

---

## Prompt 3：落地独立 CICD 仓库改造（Phase 2）

```text
在 `../your-cicd-repo` 创建分支 `feat/jenkins-3stage-orchestrator`，按已选定的编排模式（Push 回调模式或轮询模式）与触发节奏完成适配：
1. 创建 `config/branch-env-map.json`，填入真实活跃的 `develop-YYYYMM` 分支映射、3 个 Jenkins Job 路径及分阶段超时参数；
2. 适配对应 Workflow（`jenkins-callback-orchestrator.yml` 或 `jenkins-3stage-orchestrator.yml`）与可选 `release-train.yml`；
3. 适配 `scripts/jenkins-orchestrator.mjs`（若选轮询模式）和只读排障脚本 `scripts/jenkins-inspect.mjs`；
4. 用 `node --check` 校验所有脚本语法并给出干跑验证命令。
```
