# 企业内网落地教程（GHES + 低权限 Jenkins + Teams + 无 MCP Copilot）

本文档用于指导将本模板安全、分阶段落地到真实企业 React 项目中。

---

## 一、角色与凭据隔离清单（上线前必看）

**核心安全红线**：业务代码仓库绝不保存 Jenkins API Token 或 Teams Webhook。

| 存放位置 | Secret / Variable 名称 | 权限范围与用途 |
| :--- | :--- | :--- |
| **`frontend-app`（业务仓）** | `secrets.CICD_DISPATCH_TOKEN` | 仅对 `frontend-cicd` 仓库有 `contents: write`（用于发 `repository_dispatch`） |
| **`frontend-app`（业务仓）** | `vars.CICD_REPO` | 独立 CICD 仓库路径，如 `my-org/frontend-cicd` |
| **`frontend-app`（业务仓）** | `secrets.GITGUARDIAN_API_KEY` | 用于 GHES PR 门禁跑 `ggshield` |
| **`frontend-cicd`（CICD 仓）** | `secrets.JENKINS_URL` | 内网 Jenkins 地址，如 `https://jenkins.company.internal` |
| **`frontend-cicd`（CICD 仓）** | `secrets.JENKINS_USER` | DevOps 分配的项目级普通账号（仅 `Read + Build`） |
| **`frontend-cicd`（CICD 仓）** | `secrets.JENKINS_API_TOKEN` | 上述普通账号的 API Token（免 CSRF Crumb） |
| **`frontend-cicd`（CICD 仓）** | `secrets.TEAMS_WEBHOOK_URL` | Microsoft Teams Workflows Webhook URL |
| **`frontend-cicd`（CICD 仓）** | `secrets.APP_REPO_COMMENT_TOKEN` | 仅对 `frontend-app` 有 `pull-requests: write`（用于把失败日志回写到原 PR） |

---

## 二、向 DevOps 申请最小权限话术（0 插件、不改全局配置）

可直接将下面这段发给 DevOps 团队：

> 你好，我们前端团队正在将 React 项目的 PR 合并后手动依次点击 `dev/<app>-ci` → `dev/<app>-release` → `uat/<app>-cd` 的操作改成内网 GHES Actions 自动串行触发，**不需要在 Jenkins 安装任何插件，也不修改现有 Pipeline 脚本或全局配置**。麻烦协助两件最小事项：
> 1. 提供一个仅限我们项目 `dev/<app>*` 和 `uat/<app>*` 目录的**普通服务账号 + API Token**（只需要 `Job/Read` + `Job/Build` 权限，不需要 Configure/Admin 权限）；
> 2. 确认上述 3 个 Job 的参数名（如分支参数、环境参数、版本号参数）即可。

---

## 三、GHES 强门禁配置（确保门禁全过才能点 Merge）

在业务仓库的 `Settings → Rules → Rulesets → New branch ruleset`：
1. **Target branches**：添加 pattern `develop-*`（匹配 `develop-202701` 等所有月度 release 分支）。
2. 勾选 **Require a pull request before merging**：
   - `Required approvals`: `1`（Leader Review）
   - 勾选 `Dismiss stale pull request approvals when new commits are pushed`
3. 勾选 **Require status checks to pass**：
   - 勾选 `Require branches to be up to date before merging`
   - 添加必需 Check：
     - `ggshield Secret Scan`
     - `Commit Message Check`
     - `Oxlint & ESLint`
     - `Vitest Related UT`

---

## 四、配置 Microsoft Teams 实时告警卡片

1. 在目标研发 Teams 群频道右侧点击 **`...` → Workflows（工作流）**。
2. 选择模板：**`Post to a channel when a webhook request is received`**。
3. 创建完成后复制生成的 Webhook URL，填入 `frontend-cicd` 仓库的 `secrets.TEAMS_WEBHOOK_URL`。
4. 失败时卡片会自动推送：失败阶段、目标环境（如 `env3 / uat3`）、报错栈摘录、Jenkins 日志链接、断点续跑链接、以及可直接粘贴给 Copilot 的只读排障命令。

---

## 五、每月新建 Release 分支的标准操作（10 秒搞定）

例如进入 2 月 Release，新建 `develop-202702` 分支对应 `uat4 (env4)`：
1. 在 `frontend-cicd/config/branch-env-map.json` 新增一条映射并合并：
   ```json
   "develop-202702": {
     "env": "env4",
     "uatAlias": "uat4",
     "previewUrl": "https://env4.uat.example.internal/"
   }
   ```
2. 后续所有合并到 `develop-202702` 的 PR 都会自动路由到 `env4`，与 `develop-202701 (env3)` **完全并行互不阻塞**。

---

## 六、3 阶段稳妥上线计划

- **Phase 1（第 1 周，零 DevOps 依赖）**：在 `frontend-app` 上线 `pr-gate.yml` + GHES Rulesets + `.github/copilot-instructions.md` + `skills/ship-pr`。
- **Phase 2（第 2 周，1 个低权限 Token）**：在 `frontend-cicd` 上线 `branch-env-map.json` + `jenkins-orchestrator.mjs` + `jenkins-3stage-orchestrator.yml` + Teams Webhook；先选 1 个开发分支（如 `develop-202701`）灰度试跑 3~5 天。
- **Phase 3（第 3~4 周，全面稳定）**：全量开启所有 `develop-*` 分支；验证断点续跑（`workflow_dispatch`）、同事占坑等待、以及前端 `vite:preloadError` Chunk 404 自愈兜底。
