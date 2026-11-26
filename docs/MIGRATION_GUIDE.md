# 落地配置与架构选型指南

本文档涵盖 GHES 门禁配置、双仓凭据隔离、长耗时流水线低负载模式选型及 Microsoft Teams 告警接入。

---

## 一、凭据隔离清单

业务代码仓库不保存任何 Jenkins API Token 或 Teams Webhook。

| 存放位置 | Secret / Variable | 权限范围与用途 |
| :--- | :--- | :--- |
| **`frontend-app`** | `secrets.CICD_DISPATCH_TOKEN` | 仅对 `frontend-cicd` 仓库有 `contents: write`（用于发 `repository_dispatch`） |
| **`frontend-app`** | `vars.CICD_REPO` | 独立 CICD 仓库路径，如 `my-org/frontend-cicd` |
| **`frontend-app`** | `vars.DEPLOY_TRIGGER_MODE` | `opt-in`（默认，仅打标/`/deploy`触发）或 `auto`（合并即触发） |
| **`frontend-app`** | `secrets.GITGUARDIAN_API_KEY` | GHES PR 门禁跑 `ggshield` |
| **`frontend-cicd`** | `secrets.JENKINS_URL` | 内网 Jenkins 地址 |
| **`frontend-cicd`** | `secrets.JENKINS_USER` | 项目级普通账号（仅 `Job/Read` + `Job/Build`） |
| **`frontend-cicd`** | `secrets.JENKINS_API_TOKEN` | 上述普通账号的 API Token（免 CSRF Crumb） |
| **`frontend-cicd`** | `secrets.TEAMS_WEBHOOK_URL` | Microsoft Teams Workflows Webhook URL |
| **`frontend-cicd`** | `secrets.APP_REPO_COMMENT_TOKEN` | 仅对 `frontend-app` 有 `pull-requests: write`（回写失败日志到 PR） |
| **`frontend-cicd`** | `vars.APP_REPO` & `secrets.APP_REPO_READ_TOKEN` | 启用定时班车（`release-train.yml`）时读取分支 HEAD |

---

## 二、触发节奏与编排模式选型（适配 ~47 分钟重型流水线）

当 `CI (~15m) + Release (~25m) + CD (~7m)` 总耗时约 47 分钟时，建议从**触发频次**和**编排方式**两个维度控制服务器负载：

### 1. 触发频次（防 Jenkins 构建机过载）

| 模式 | 对应配置 | 适用场景 |
| :--- | :--- | :--- |
| **按需打标 / `/deploy`（默认推荐）** | `vars.DEPLOY_TRIGGER_MODE=opt-in` | 合并频率不确定或偏高；普通 PR 仅过 PR 门禁，需要发 UAT 时打 `deploy:auto` 标签或在已合并 PR 下评论 `/deploy` |
| **定时班车合批（Release Train）** | 启用 `frontend-cicd/.github/workflows/release-train.yml` | 固定发车窗口（如工作日 11:30 / 16:30 / 20:00），自动比对 HEAD 是否有新 Commit，多 PR 合并成 1 班车发布 |
| **合并自动触发 + 自动合批** | `vars.DEPLOY_TRIGGER_MODE=auto` | 合并频次较低；依赖 Actions `concurrency (cancel-in-progress: false)` 保持最多 1 运行 + 1 排队，中间 PR 自动合并为最新 HEAD |

### 2. 编排方式（防 GHES Runner 槽位空等）

| 模式 | 对应文件 | Runner 占用 | 是否需修改 Jenkinsfile |
| :--- | :--- | :--- | :---: |
| **事件回调 Push 模式（最优）** | `jenkins-callback-orchestrator.yml` + `snippets/jenkins-callback.groovy` | 每次约 **3 秒**（全程 ~12 秒，零轮询） | 需在 3 个 Job 的 `post` 加 ~15 行 `curl` 回调 |
| **低权限轮询模式（零侵入）** | `jenkins-3stage-orchestrator.yml` + `scripts/jenkins-orchestrator.mjs` | 占用单槽位（建议绑定专用 1C1G 轻量 Runner 标签与主 CI 隔离） | **不需要**（内置同事手动占坑检测与礼貌等待） |

> **Push 回调模式防丢包建议**：若采用事件回调模式，可额外配一个每 30 分钟运行一次、耗时 5 秒的轻量巡检任务，检查是否有超过 1 小时未收到回调的构建，避免极端网络闪断导致失联。

---

## 三、GHES 单点 PR 门禁配置

在 `frontend-app` 仓库 `Settings → Rules → Rulesets → New branch ruleset`：
1. **Target branches**：`develop-*`
2. 勾选 **Require a pull request before merging**（`Required approvals: 1`，勾选 `Dismiss stale approvals`）。
3. 勾选 **Require status checks to pass**（勾选 `Require branches to be up to date`），添加：
   - `ggshield Secret Scan`
   - `Commit Message Check`
   - `Oxlint & ESLint`
   - `Vitest Related UT`

---

## 四、Microsoft Teams Workflows 告警配置

1. 在目标 Teams 频道点击 **`...` → Workflows**。
2. 选择模板：**`Post to a channel when a webhook request is received`**。
3. 复制生成的 Webhook URL，写入 `frontend-cicd` 的 `secrets.TEAMS_WEBHOOK_URL`。
4. 任意阶段失败时，卡片会自动包含：失败阶段、目标环境、报错摘录、Jenkins 日志链接、**免重跑前序阶段的断点续跑参数（`start_from` / `artifact_version` / `release_version`）**，以及可直接复制给 Copilot 的只读排障命令。

---

## 五、每月新增 Release 分支操作

新建 `develop-202702` 对应 `uat4 (env4)` 时，只需在 `frontend-cicd/config/branch-env-map.json` 增加一条映射即可：

```json
"develop-202702": {
  "env": "env4",
  "uatAlias": "uat4",
  "previewUrl": "https://env4.uat.example.internal/"
}
```
