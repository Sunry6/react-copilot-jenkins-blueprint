# React + Enterprise Copilot + 3-Stage Jenkins CI/CD Blueprint

一套面向**企业内网 GitHub Enterprise Server (GHES) + DevOps 管控的低权限 Jenkins + 未开启 Copilot MCP** 场景的 React 前端 AI 研发全链路参考模板与落地教程。

> **合规与脱敏声明**：本仓库不包含任何真实公司信息、内部域名、Token 或私密配置，所有脚本均采用标准 REST API 与合规工作区 CLI 模式（**不绕过、不伪装任何企业安全策略**）。

---

## 一、核心解决什么问题？

针对典型的企业 React 前端研发模式：
- **分支与环境强绑定**：每个月度 Release 对应一个开发分支和一套 UAT 环境（例如 `develop-202701` → `env3 / uat3`，在 [`frontend-cicd/config/branch-env-map.json`](frontend-cicd/config/branch-env-map.json) 中统一配置）。
- **无重复做功的单点 PR 硬门禁（不跑 Build）**：本地 `pre-commit` 极简仅保留 `<1s` 的 `ggshield`（防密文在 `push` 前泄露）；`oxlint` + `eslint` + `commitlint` + PR 级 `vitest related` **只在 GHES PR Gate 跑一遍**，由 Rulesets 物理锁死 Merge 按钮，既不卡本地提交又无法 `--no-verify` 绕过。
- **双仓隔离（App 仓 + 独立 CICD 仓）**：Jenkins Token 与 Teams Webhook 仅保存在 `frontend-cicd` 仓库，业务代码仓零部署凭据。
- **低权限串联 3 个现有 Jenkins Job**：PR 合并后自动按序触发 `dev/<app>-ci` → `dev/<app>-release` → `uat/<app>-cd`，精确传递产物/版本号，**无需 Jenkins 管理员权限或安装插件**。
- **外部手动占坑检测与自动避让**：触发前主动查询 Jenkins 运行中 Build 与 Queue，若同事正在手动跑同一环境，自动打印占用者并礼貌等待，**绝不冲突、绝不串号**。
- **失败即时告警 + 无 MCP 合规排障**：任意阶段失败自动推送 **Microsoft Teams Adaptive Card** 并回写原 PR 评论（进 Copilot Desktop `My Work`），附带一行合规只读 CLI 命令（`npm run jenkins:log`）供 Copilot CLI / Desktop 直接查日志修复。

---

## 二、仓库结构

```text
react-copilot-jenkins-blueprint/
├── frontend-app/                       # React + Vite + TS 业务仓库模板
│   ├── .husky/                         # 极简本地 pre-commit（仅 <1s ggshield，不重复跑 lint/UT）
│   ├── .github/
│   │   ├── copilot-instructions.md     # 无 MCP 合规 Copilot 工程规范
│   │   ├── skills/ship-pr/SKILL.md     # Copilot 一键自测并提 PR 技能
│   │   └── workflows/
│   │       ├── pr-gate.yml             # GHES PR 硬门禁（无 build，PR 级 vitest related）
│   │       └── trigger-cicd.yml        # PR 合并后跨仓 dispatch 到 CICD 仓（零 Jenkins 密钥）
│   └── src/                            # React 示例源码 + Vitest 单测 + Chunk 404 自愈兜底
├── frontend-cicd/                      # 独立 CICD 仓库模板
│   ├── config/branch-env-map.json      # 分支 -> 环境映射表（如 develop-202701 -> env3）
│   ├── scripts/
│   │   ├── jenkins-orchestrator.mjs    # 零依赖核心引擎：3 段串联 + 占坑避让 + 断点续跑 + Teams 卡片
│   │   └── jenkins-inspect.mjs         # 合规只读 CLI：无 MCP 供 Copilot 查状态/精准日志
│   └── .github/workflows/
│       └── jenkins-3stage-orchestrator.yml  # GHES 三段编排 + 按环境互斥锁 + 回写原 PR
├── local-sandbox/                      # 可选：一键本地 Docker 复现 dev/ + uat/ 三段 Jenkins
└── docs/
    ├── MIGRATION_GUIDE.md              # 企业 GHES + Jenkins + Teams 分步落地教程
    └── COPILOT_ADAPTATION_PROMPT.md    # ⭐ 直接喂给公司 Copilot 的自动适配提示词
```

---

## 三、全链路架构流

```text
Copilot Desktop / CLI (本地开发)
  │  1. 本地提交仅跑 <1s ggshield（防密文 push），不重复卡顿
  │  2. 提 PR 至 develop-202701
  ▼
GHES PR 硬门禁 (frontend-app/.github/workflows/pr-gate.yml)
  │  3. 单点权威裁判: ggshield + oxlint/eslint + commitlint + PR 级 vitest related + Leader Approve
  │     (未全绿前 Merge 按钮物理锁死；不跑 build)
  ▼
Leader 点击 Merge ──▶ trigger-cicd.yml (跨仓 repository_dispatch)
  ▼
frontend-cicd (jenkins-3stage-orchestrator.yml)
  │  4. 查表映射: develop-202701 -> env3 (uat3)，按 env3 加 concurrency 排队锁
  │  5. 冲突避让: 检查 Jenkins 正在运行/排队任务，若同事正跑同环境则自动等待
  │  6. 精确串联: dev/ci -> 取 ARTIFACT_VERSION -> dev/release -> 取 RELEASE_VERSION -> uat/cd
  ├──▶ [全绿] 推 Teams 成功卡片 + 回写原 PR 预览地址
  └──▶ [失败] 推 Teams 红色告警卡片（含断点续跑按钮 + Copilot 排障命令）+ 回写原 PR 评论
```

---

## 四、明天在公司怎么用这个仓库？

1. 克隆本仓库到公司电脑（例如放到业务仓库同级目录）：
   ```bash
   git clone https://github.com/Sunry6/react-copilot-jenkins-blueprint.git
   ```
2. 打开 **Copilot Desktop** 或 **Copilot CLI**，把本仓库作为参考目录喂给 Copilot：
   ```bash
   cd /path/to/your-company-react-repo
   copilot --add-dir ../react-copilot-jenkins-blueprint --add-dir ../your-company-cicd-repo
   ```
3. 直接复制 [`docs/COPILOT_ADAPTATION_PROMPT.md`](docs/COPILOT_ADAPTATION_PROMPT.md) 里的提示词发给 Copilot，让它自动对照你们真实的 Jenkins Job 路径、参数名和分支规则生成定制方案与 PR。
4. 详细企业配置步骤（GHES Rulesets、Secrets 隔离、Teams Webhook、DevOps 最小权限申请话术）见 [`docs/MIGRATION_GUIDE.md`](docs/MIGRATION_GUIDE.md)。
