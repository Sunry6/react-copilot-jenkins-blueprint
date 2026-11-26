# 给公司 Enterprise Copilot 使用的自动适配 Prompt

> **使用方式**：
> 1. 在公司电脑克隆本模板仓库到业务项目同级目录；
> 2. 用 **Copilot Desktop**（同时添加本模板仓 + 公司 React 仓 + 公司 CICD 仓）或 **Copilot CLI**：
>    ```bash
>    cd /path/to/company-react-repo
>    copilot --add-dir ../react-copilot-jenkins-blueprint --add-dir ../company-cicd-repo
>    ```
> 3. 直接把下面对应阶段的 Prompt 发给 Copilot（推荐选 Claude Opus / 顶级推理模型）。

---

## Prompt 1：让 Copilot 扫描公司双仓并产出定制化改造方案（先规划，不直接改代码）

```text
请先完整阅读参考模板仓库 `../react-copilot-jenkins-blueprint` 中的：
- README.md
- docs/MIGRATION_GUIDE.md
- frontend-app/.github/workflows/pr-gate.yml & trigger-cicd.yml
- frontend-app/.github/copilot-instructions.md
- frontend-cicd/config/branch-env-map.json
- frontend-cicd/scripts/jenkins-orchestrator.mjs & jenkins-inspect.mjs
- frontend-cicd/.github/workflows/jenkins-3stage-orchestrator.yml

然后仔细分析我们当前真实的 React 业务仓库和 `../company-cicd-repo` 仓库：
1. 识别我们现有的 git hooks（ggshield / oxlint / eslint / commitlint / vitest related）、包管理器（npm / pnpm / yarn）以及 Node 版本；
2. 识别 `../company-cicd-repo` 中已有的 Jenkinsfile、环境列表（如 env1-env5, sim）和真实的 3 个 Jenkins Job 路径与入参名称（dev 下的 CI/Release、uat 下的 CD）；
3. 识别我们现有的分支命名规范（如 develop-YYYYMM 对应 uatX）；
4. 严格遵守以下约束：
   - PR 门禁不跑 build，只跑 ggshield + oxlint/eslint + commit message 校验 + PR 级 vitest related（改动全局配置时才兜底全量）；
   - 我们无 Jenkins 管理员权限，不得要求安装 Jenkins 插件；
   - 公司未开启 Copilot MCP，采用合规的仓库只读 CLI 脚本（jenkins-inspect.mjs），不得尝试绕过或伪装 MCP；
   - 凭据隔离：Jenkins Token 与 Teams Webhook 仅放在 CICD 仓库 Secrets 中；
   - 必须保留外部同事手动跑同环境 Job 时的占坑检测与礼貌等待机制，以及失败时断点续跑与 Teams 卡片告警。

请输出一份针对我们真实项目的《差异对照表 + 改造实施清单》，列出所有需要确认的真实 Job 名、参数名和变量名，等待我确认后再动手修改文件。
```

---

## Prompt 2：确认参数后，让 Copilot 落地 Phase 1（业务仓 PR 门禁 + Copilot 规范）

```text
请严格按照你刚才输出的方案和我确认的参数，在当前 React 业务仓库创建一个新分支 `chore/setup-pr-gate-and-copilot-workflow`，完成以下改造：
1. 生成 `.github/workflows/pr-gate.yml`（匹配我们真实的包管理器、oxlint/eslint 命令、commitlint 和 PR 级 vitest related，不跑 build）；
2. 生成 `.github/workflows/trigger-cicd.yml`（仅在 PR 合并到 `develop-*` 分支后跨仓 dispatch 到我们的 CICD 仓库，不引入任何 Jenkins 凭据）；
3. 生成或更新 `.github/copilot-instructions.md` 和 `.github/skills/ship-pr/SKILL.md`；
4. 检查本地 pre-commit/commit-msg hooks，确保与 PR 门禁口径一致；
5. 运行本地 lint 和相关单测验证所有修改无语法或配置错误，然后展示 diff 给我审核。
```

---

## Prompt 3：落地 Phase 2（独立 CICD 仓库的三段编排 + 占坑避让 + 只读排障脚本）

```text
请切换到 `../company-cicd-repo` 创建新分支 `feat/jenkins-3stage-orchestrator`，参考 `../react-copilot-jenkins-blueprint/frontend-cicd/` 完成适配：
1. 创建 `config/branch-env-map.json`，填入我们真实活跃的 `develop-YYYYMM` 分支与 `env1-env5`/`sim` 映射以及真实的 3 个 Jenkins Job 路径；
2. 适配 `scripts/jenkins-orchestrator.mjs`：
   - 对齐 3 个 Job 的真实参数名（例如分支、环境、版本号参数）；
   - 对齐从 CI / Release 日志或 API 中提取精确版本号的规则；
   - 保留触发前的 Jenkins 运行中 Build + Queue 占坑冲突检测与自动等待；
   - 保留 Teams Workflows Adaptive Card 告警与成功推送；
3. 适配只读排障脚本 `scripts/jenkins-inspect.mjs`（严格只读 GET API，零写入/触发操作）；
4. 生成 `.github/workflows/jenkins-3stage-orchestrator.yml`（带按环境分桶的 `concurrency` 锁、`workflow_dispatch` 断点续跑、以及结果回写原 PR 评论）；
5. 用 `node --check` 校验所有脚本语法，并给出干跑（Dry-Run）测试命令给我验证。
```
