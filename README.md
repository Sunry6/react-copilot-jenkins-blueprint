# React + Enterprise Copilot + 3-Stage Jenkins CI/CD Blueprint

面向 **GHES（GitHub Enterprise Server）+ 分文件夹三段式 Jenkins（`dev/ci → dev/release → uat/cd`）+ 企业版 GitHub Copilot（无 MCP）** 场景的 React 前端自动化研发与发布架构模板。

---

## 一、核心特性

- **分支与环境强绑定**：每个月度 Release 分支映射到一个独立 UAT 环境（例如 `develop-202701` → `env3 / uat3`），统一维护在 [`frontend-cicd/config/branch-env-map.json`](frontend-cicd/config/branch-env-map.json)。
- **单点 PR 硬门禁（不重复跑两遍，不跑 Build）**：
  - 本地 `pre-commit` 仅保留 `<1s` 的 `ggshield`（防密文在 `push` 前进入远端）；
  - `oxlint` + `eslint` + `commitlint` + PR 级 `vitest related`（改全局配置自动兜底全量）统一在 GHES PR Gate 跑一遍，配合 Rulesets 物理锁死 Merge 按钮。
- **双仓隔离（App 仓 + 独立 CICD 仓）**：Jenkins Token 与 Teams Webhook 仅保存在 `frontend-cicd` 仓库，业务代码仓零部署凭据。
- **长耗时流水线低负载方案（适配 CI ~15m + Release ~25m + CD ~7m）**：
  - **三种触发节奏可选**：按需标签/`/deploy` 触发（默认 `opt-in`）、定时班车合批发布（[`release-train.yml`](frontend-cicd/.github/workflows/release-train.yml)）、或合并自动合批（`concurrency` 自动合并排队 PR）。
  - **两种编排模式可选**：
    1. **零轮询事件回调模式**（[`jenkins-callback-orchestrator.yml`](frontend-cicd/.github/workflows/jenkins-callback-orchestrator.yml) + [`jenkins-callback.groovy`](frontend-cicd/snippets/jenkins-callback.groovy)）：每次触发 3 秒释放 Runner，由 Jenkins `post` 主动回传推进下一阶段；
    2. **零改造低权限轮询模式**（[`jenkins-3stage-orchestrator.yml`](frontend-cicd/.github/workflows/jenkins-3stage-orchestrator.yml) + [`jenkins-orchestrator.mjs`](frontend-cicd/scripts/jenkins-orchestrator.mjs)）：无需修改 Jenkinsfile，内置**同事手动占坑检测与礼貌等待**、精确 Queue-ID 追踪、分阶段超时与断点续跑。
- **实时告警与无 MCP 合规排障**：失败自动推送 **Microsoft Teams Adaptive Card** 并回写原 PR 评论（进 Copilot Desktop `My Work`），配套纯只读 CLI [`jenkins-inspect.mjs`](frontend-cicd/scripts/jenkins-inspect.mjs) 供 Copilot CLI / Desktop 查状态与错误日志。

---

## 二、仓库结构

```text
react-copilot-jenkins-blueprint/
├── frontend-app/                       # React + Vite + TS 业务仓库模板
│   ├── .husky/                         # 极简本地 pre-commit（仅 <1s ggshield）
│   ├── .github/
│   │   ├── copilot-instructions.md     # 无 MCP 场景下的 Copilot 协作规范
│   │   ├── skills/ship-pr/SKILL.md     # Copilot 自测与提 PR 技能
│   │   └── workflows/
│   │       ├── pr-gate.yml             # GHES 单点 PR 门禁（无 build，PR 级 vitest related）
│   │       └── trigger-cicd.yml        # 支持 opt-in 标签 / `/deploy` 评论 / 自动触发
│   └── src/                            # React 示例源码 + Vitest 单测 + Chunk 404 刷新兜底
├── frontend-cicd/                      # 独立 CICD 仓库模板
│   ├── config/branch-env-map.json      # 分支 -> 环境映射与分阶段超时配置
│   ├── scripts/
│   │   ├── jenkins-orchestrator.mjs    # 3 段串联 + 占坑避让 + 断点续跑 + Teams 卡片
│   │   └── jenkins-inspect.mjs         # 只读 CLI：无 MCP 供 Copilot 查状态/日志
│   ├── snippets/
│   │   └── jenkins-callback.groovy     # Jenkinsfile 主动回调片段（零轮询 Push 模式）
│   └── .github/workflows/
│       ├── jenkins-3stage-orchestrator.yml    # 模式 A：零改 Jenkins 的轮询编排
│       ├── jenkins-callback-orchestrator.yml  # 模式 B：零 Runner 空等的回调编排
│       └── release-train.yml                  # 定时班车合批发布
├── local-sandbox/                      # 本地 Docker 沙箱（复现 dev/ + uat/ 三段 Jenkins）
└── docs/
    ├── MIGRATION_GUIDE.md              # 详细配置与架构选型指南
    └── COPILOT_ADAPTATION_PROMPT.md    # 供 Copilot 扫描并适配目标双仓的 Prompt 模板
```

---

## 三、快速接入

```bash
git clone https://github.com/Sunry6/react-copilot-jenkins-blueprint.git
cd /path/to/your-react-app
copilot --add-dir ../react-copilot-jenkins-blueprint --add-dir ../your-cicd-repo
```

参考 [`docs/MIGRATION_GUIDE.md`](docs/MIGRATION_GUIDE.md) 完成 GHES Rulesets、Secrets 隔离与触发模式选择，或直接使用 [`docs/COPILOT_ADAPTATION_PROMPT.md`](docs/COPILOT_ADAPTATION_PROMPT.md) 引导 Copilot 适配现有仓库。
