#!/usr/bin/env node
/**
 * 3-Stage Jenkins Orchestrator (dev/ci -> dev/release -> uat/cd)
 *
 * Key stability guarantees (ZERO Jenkins admin permissions required):
 * 1. Branch-to-Env resolution from config/branch-env-map.json (e.g. develop-202701 -> env3)
 * 2. Live conflict detection against external manual Jenkins runs & Queue (waits politely instead of colliding!)
 * 3. Exact Queue-ID -> Build-Number tracking (never polls ambiguous lastBuild)
 * 4. Transient HTTP retry with backoff + strict timeout protection
 * 5. Resume from any failed stage (--start-from ci|release|cd)
 * 6. Microsoft Teams Workflows Adaptive Card notification on failure/success
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MAP_PATH = path.resolve(__dirname, "../config/branch-env-map.json");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toJenkinsJobPath(logicalPath) {
  // Converts "dev/react-demo-ci" -> "job/dev/job/react-demo-ci"
  return logicalPath
    .split("/")
    .filter(Boolean)
    .map((seg) => `job/${encodeURIComponent(seg)}`)
    .join("/");
}

function getAuthHeader() {
  const user = process.env.JENKINS_USER;
  const token = process.env.JENKINS_API_TOKEN;
  if (!user || !token) {
    throw new Error("Missing JENKINS_USER or JENKINS_API_TOKEN environment variables.");
  }
  return `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
}

async function fetchWithRetry(url, options = {}, retries = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      if (res.status >= 500 && attempt < retries) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const backoffMs = Math.min(2000 * attempt, 10_000);
        console.warn(`⚠️  Transient request error (${err.message}), retrying in ${backoffMs}ms (${attempt}/${retries})...`);
        await sleep(backoffMs);
      }
    }
  }
  throw lastErr;
}

async function jenkinsJson(jenkinsUrl, relPath) {
  const res = await fetchWithRetry(`${jenkinsUrl}/${relPath.replace(/^\/+/, "")}`, {
    headers: { Authorization: getAuthHeader() },
  });
  if (!res.ok) {
    throw new Error(`Jenkins GET ${relPath} failed: HTTP ${res.status}`);
  }
  return res.json();
}

async function jenkinsText(jenkinsUrl, relPath) {
  const res = await fetchWithRetry(`${jenkinsUrl}/${relPath.replace(/^\/+/, "")}`, {
    headers: { Authorization: getAuthHeader() },
  });
  if (!res.ok) {
    throw new Error(`Jenkins GET ${relPath} failed: HTTP ${res.status}`);
  }
  return res.text();
}

function extractParams(actions = []) {
  const out = {};
  for (const a of actions || []) {
    if (a && Array.isArray(a.parameters)) {
      for (const p of a.parameters) {
        out[p.name] = p.value;
      }
    }
  }
  return out;
}

function extractTriggerUser(actions = []) {
  for (const a of actions || []) {
    if (a && Array.isArray(a.causes)) {
      for (const c of a.causes) {
        if (c.userName) return c.userName;
        if (c.userId) return c.userId;
        if (c.shortDescription) return c.shortDescription;
      }
    }
  }
  return "unknown";
}

/**
 * Detect if a colleague manually (or another pipeline) is currently running or queuing
 * the SAME Jenkins job for the SAME target ENV. Wait politely until idle!
 */
async function waitUntilJobEnvIdle({ jenkinsUrl, logicalJob, targetEnv, maxWaitSec, pollIntervalSec }) {
  const jobPath = toJenkinsJobPath(logicalJob);
  const start = Date.now();
  let announcedWait = false;

  while ((Date.now() - start) / 1000 < maxWaitSec) {
    const [jobInfo, queueInfo] = await Promise.all([
      jenkinsJson(
        jenkinsUrl,
        `${jobPath}/api/json?tree=builds[number,building,actions[parameters[name,value],causes[userName,userId,shortDescription]]]{0,10}`
      ),
      jenkinsJson(
        jenkinsUrl,
        `queue/api/json?tree=items[id,task[url,name],actions[parameters[name,value],causes[userName,userId,shortDescription]]]`
      ),
    ]);

    const busyBuild = (jobInfo.builds || []).find((b) => {
      if (!b.building) return false;
      const p = extractParams(b.actions);
      return !targetEnv || !p.ENV || p.ENV === targetEnv;
    });

    const busyQueue = (queueInfo.items || []).find((q) => {
      const taskUrl = q.task?.url || "";
      if (!taskUrl.includes(`/${jobPath}/`) && !taskUrl.endsWith(`/${jobPath}`)) return false;
      const p = extractParams(q.actions);
      return !targetEnv || !p.ENV || p.ENV === targetEnv;
    });

    if (!busyBuild && !busyQueue) {
      if (announcedWait) {
        console.log(`✅ Conflict cleared! ${logicalJob} [ENV=${targetEnv}] is now idle.`);
      }
      return;
    }

    const holder = busyBuild
      ? `Build #${busyBuild.number} (started by: ${extractTriggerUser(busyBuild.actions)})`
      : `Queue #${busyQueue.id} (started by: ${extractTriggerUser(busyQueue.actions)})`;

    console.log(
      `⏳ [Conflict Avoidance] ${logicalJob} [ENV=${targetEnv}] is currently occupied by ${holder}. Waiting ${pollIntervalSec}s...`
    );
    announcedWait = true;
    await sleep(pollIntervalSec * 1000);
  }

  throw new Error(
    `Conflict timeout: ${logicalJob} [ENV=${targetEnv}] remained busy for >${maxWaitSec}s.`
  );
}

/**
 * Trigger a parameterized Jenkins job and track the EXACT build via Queue Location header.
 */
async function triggerAndWaitBuild({
  jenkinsUrl,
  logicalJob,
  params,
  targetEnv,
  maxWaitConflictSec,
  maxBuildSec,
  pollIntervalSec,
}) {
  await waitUntilJobEnvIdle({
    jenkinsUrl,
    logicalJob,
    targetEnv,
    maxWaitSec: maxWaitConflictSec,
    pollIntervalSec,
  });

  const jobPath = toJenkinsJobPath(logicalJob);
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      body.set(k, String(v));
    }
  }

  console.log(`\n🚀 Triggering ${logicalJob} with params: ${JSON.stringify(params)}`);
  const triggerRes = await fetchWithRetry(`${jenkinsUrl}/${jobPath}/buildWithParameters`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    redirect: "manual",
  });

  if (triggerRes.status < 200 || triggerRes.status >= 400) {
    const errText = await triggerRes.text();
    throw new Error(`Failed to trigger ${logicalJob}: HTTP ${triggerRes.status} ${errText.slice(0, 300)}`);
  }

  const queueLocation = triggerRes.headers.get("location");
  if (!queueLocation) {
    throw new Error(`Jenkins did not return Location header for ${logicalJob}`);
  }

  // Normalize queue URL to use configured jenkinsUrl (handles reverse-proxy hostnames cleanly)
  const queuePath = new URL(queueLocation).pathname.replace(/^\/+/, "");
  let buildNumber = null;
  const qStart = Date.now();
  while ((Date.now() - qStart) / 1000 < maxWaitConflictSec) {
    const qData = await jenkinsJson(jenkinsUrl, `${queuePath}api/json`);
    if (qData.cancelled) {
      throw new Error(`Queued build for ${logicalJob} was cancelled in Jenkins.`);
    }
    if (qData.executable?.number) {
      buildNumber = qData.executable.number;
      break;
    }
    await sleep(2000);
  }
  if (!buildNumber) {
    throw new Error(`Timed out waiting for Jenkins build number for ${logicalJob}`);
  }

  const buildUrl = `${jenkinsUrl}/${jobPath}/${buildNumber}/`;
  console.log(`📦 ${logicalJob} Build #${buildNumber} started: ${buildUrl}`);

  const bStart = Date.now();
  let result = null;
  let lastHeartbeat = bStart;
  while ((Date.now() - bStart) / 1000 < maxBuildSec) {
    const bData = await jenkinsJson(
      jenkinsUrl,
      `${jobPath}/${buildNumber}/api/json?tree=building,result,duration`
    );
    if (!bData.building) {
      result = bData.result;
      break;
    }
    const elapsedSec = Math.round((Date.now() - bStart) / 1000);
    if (Date.now() - lastHeartbeat >= 60_000) {
      console.log(`⏱️  ${logicalJob} #${buildNumber} still running (${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s elapsed)...`);
      lastHeartbeat = Date.now();
    }
    await sleep(pollIntervalSec * 1000);
  }

  const totalSec = Math.round((Date.now() - bStart) / 1000);
  const consoleText = await jenkinsText(jenkinsUrl, `${jobPath}/${buildNumber}/consoleText`);
  if (result !== "SUCCESS") {
    const tail = consoleText.split("\n").slice(-80).join("\n");
    const err = new Error(`${logicalJob} #${buildNumber} finished with status: ${result || "TIMEOUT"} after ${totalSec}s`);
    err.stageJob = logicalJob;
    err.buildNumber = buildNumber;
    err.buildUrl = buildUrl;
    err.consoleTail = tail;
    throw err;
  }

  console.log(`✅ ${logicalJob} #${buildNumber} SUCCEEDED in ${Math.floor(totalSec / 60)}m ${totalSec % 60}s.`);
  return { buildNumber, buildUrl, consoleText, elapsedSec: totalSec };
}

function parseOutputVar(consoleText, key) {
  const re = new RegExp(`^${key}=(.+)$`, "m");
  const m = consoleText.match(re);
  return m ? m[1].trim() : "";
}

function buildTeamsAdaptiveCard({ status, branch, env, uatAlias, commit, prNumber, prUrl, author, failedStage, failedStageKey, buildNumber, buildUrl, artifactVersion, releaseVersion, previewUrl, errorExcerpt, resumeUrl }) {
  const isSuccess = status === "SUCCESS";
  const title = isSuccess
    ? `✅ React 发布成功 | ${branch} → ${uatAlias} (${env})`
    : `❌ Jenkins 流水线失败 | ${failedStage} | ${branch} (${env})`;

  const copilotCmd = !isSuccess
    ? `copilot -p "运行 npm run jenkins:log -- --job ${failedStage} --build ${buildNumber || "lastFailedBuild"} 分析报错并结合分支 ${branch} 修复问题"`
    : "";

  const facts = [
    { title: "分支 / 环境", value: `${branch} → ${uatAlias} (${env})` },
    { title: "Commit", value: (commit || "N/A").slice(0, 10) },
    { title: "PR / 提交人", value: prNumber ? `#${prNumber} (@${author || "unknown"})` : author || "manual" },
  ];
  if (artifactVersion) facts.push({ title: "CI 产物版本", value: artifactVersion });
  if (releaseVersion) facts.push({ title: "Release 版本", value: releaseVersion });
  if (isSuccess && previewUrl) facts.push({ title: "预览地址", value: previewUrl });
  if (!isSuccess) {
    facts.push({ title: "失败阶段", value: `${failedStage} #${buildNumber || "?"}` });
    if (failedStageKey && failedStageKey !== "ci") {
      facts.push({
        title: "免重跑续跑参数",
        value: `start_from=${failedStageKey}${artifactVersion ? `, artifact_version=${artifactVersion}` : ""}${releaseVersion ? `, release_version=${releaseVersion}` : ""}`,
      });
    }
  }

  const body = [
    {
      type: "TextBlock",
      text: title,
      weight: "Bolder",
      size: "Medium",
      color: isSuccess ? "Good" : "Attention",
      wrap: true,
    },
    { type: "FactSet", facts },
  ];

  if (!isSuccess && errorExcerpt) {
    body.push({
      type: "TextBlock",
      text: "报错摘录：",
      weight: "Bolder",
      spacing: "Medium",
    });
    body.push({
      type: "TextBlock",
      text: errorExcerpt.slice(-1500),
      fontType: "Monospace",
      wrap: true,
      size: "Small",
    });
    body.push({
      type: "TextBlock",
      text: `Copilot 快速排障命令：\n${copilotCmd}`,
      fontType: "Monospace",
      wrap: true,
      size: "Small",
      spacing: "Small",
    });
  }

  const actions = [];
  if (buildUrl) actions.push({ type: "Action.OpenUrl", title: "查看 Jenkins 日志", url: buildUrl });
  if (prUrl) actions.push({ type: "Action.OpenUrl", title: "查看 GitHub PR", url: prUrl });
  if (!isSuccess && resumeUrl) {
    actions.push({ type: "Action.OpenUrl", title: "从失败阶段断点续跑", url: resumeUrl });
  }

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          actions,
        },
      },
    ],
  };
}

async function sendTeamsNotification(cardPayload) {
  const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("\n📣 [Teams Dry-Run] TEAMS_WEBHOOK_URL not set. Card payload preview:");
    console.log(JSON.stringify(cardPayload, null, 2));
    return;
  }
  const res = await fetchWithRetry(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cardPayload),
  });
  if (!res.ok) {
    console.warn(`⚠️  Teams webhook returned HTTP ${res.status}`);
  } else {
    console.log("📣 Teams notification delivered.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mapPath = args["map-file"] || DEFAULT_MAP_PATH;
  const config = JSON.parse(fs.readFileSync(mapPath, "utf8"));

  const jenkinsUrl = (args["jenkins-url"] || process.env.JENKINS_URL || "http://localhost:8088").replace(/\/+$/, "");
  const branch = args.branch || process.env.TARGET_BRANCH || "develop-202701";
  const commit = args.commit || process.env.TARGET_COMMIT || "";
  const startFrom = (args["start-from"] || "ci").toLowerCase();
  const timeouts = config.stageTimeoutsSec || {};
  const maxWaitConflictSec = Number(args["max-wait-conflict"] || timeouts.conflictWait || 2400);
  const ciTimeoutSec = Number(args["ci-timeout-sec"] || args["max-build-sec"] || timeouts.ci || 1800);
  const releaseTimeoutSec = Number(args["release-timeout-sec"] || args["max-build-sec"] || timeouts.release || 2700);
  const cdTimeoutSec = Number(args["cd-timeout-sec"] || args["max-build-sec"] || timeouts.cd || 1200);
  const pollIntervalSec = Number(args["poll-interval"] || timeouts.pollInterval || 20);

  const mapped = config.branchToEnv[branch];
  const targetEnv = args.env || mapped?.env;
  const uatAlias = mapped?.uatAlias || targetEnv;
  const previewUrl = mapped?.previewUrl || "";

  if (!targetEnv) {
    throw new Error(
      `Branch "${branch}" is not mapped in ${mapPath}. Add it to branchToEnv or pass --env explicitly.`
    );
  }

  console.log(`=== 3-Stage Jenkins Orchestrator ===`);
  console.log(
    `Branch: ${branch} -> Target Env: ${targetEnv} (${uatAlias}) | Start From: ${startFrom} | Timeouts(s): CI=${ciTimeoutSec}, Release=${releaseTimeoutSec}, CD=${cdTimeoutSec}, ConflictWait=${maxWaitConflictSec}, Poll=${pollIntervalSec}s`
  );

  let artifactVersion = args["artifact-version"] || "";
  let releaseVersion = args["release-version"] || "";
  let lastBuildUrl = "";
  let currentStageKey = startFrom;

  try {
    // Stage 1: dev/<app>-ci (~15 min typical -> 30 min timeout)
    if (startFrom === "ci") {
      currentStageKey = "ci";
      const ciRes = await triggerAndWaitBuild({
        jenkinsUrl,
        logicalJob: config.jenkinsJobs.ci,
        params: {
          BRANCH: branch,
          GIT_COMMIT: commit,
          ENV: targetEnv,
          SIMULATE_FAIL: args["simulate-fail"] || "",
        },
        targetEnv,
        maxWaitConflictSec,
        maxBuildSec: ciTimeoutSec,
        pollIntervalSec,
      });
      artifactVersion = parseOutputVar(ciRes.consoleText, "ARTIFACT_VERSION") || `${branch}-ci.${ciRes.buildNumber}`;
      lastBuildUrl = ciRes.buildUrl;
      console.log(`🔗 Captured ARTIFACT_VERSION=${artifactVersion}`);
    }

    // Stage 2: dev/<app>-release (~25 min typical -> 45 min timeout)
    if (startFrom === "ci" || startFrom === "release") {
      currentStageKey = "release";
      if (!artifactVersion) {
        throw new Error("--artifact-version is required when resuming from --start-from release");
      }
      const relRes = await triggerAndWaitBuild({
        jenkinsUrl,
        logicalJob: config.jenkinsJobs.release,
        params: {
          BRANCH: branch,
          GIT_COMMIT: commit,
          ENV: targetEnv,
          ARTIFACT_VERSION: artifactVersion,
        },
        targetEnv,
        maxWaitConflictSec,
        maxBuildSec: releaseTimeoutSec,
        pollIntervalSec,
      });
      releaseVersion = parseOutputVar(relRes.consoleText, "RELEASE_VERSION") || `rel-${relRes.buildNumber}`;
      lastBuildUrl = relRes.buildUrl;
      console.log(`🔗 Captured RELEASE_VERSION=${releaseVersion}`);
    }

    // Stage 3: uat/<app>-cd (~7 min typical -> 20 min timeout)
    if (startFrom === "ci" || startFrom === "release" || startFrom === "cd") {
      currentStageKey = "cd";
      if (!releaseVersion) {
        throw new Error("--release-version is required when resuming from --start-from cd");
      }
      const cdRes = await triggerAndWaitBuild({
        jenkinsUrl,
        logicalJob: config.jenkinsJobs.cd,
        params: {
          BRANCH: branch,
          GIT_COMMIT: commit,
          ENV: targetEnv,
          RELEASE_VERSION: releaseVersion,
        },
        targetEnv,
        maxWaitConflictSec,
        maxBuildSec: cdTimeoutSec,
        pollIntervalSec,
      });
      lastBuildUrl = cdRes.buildUrl;
    }

    const summary = {
      status: "SUCCESS",
      branch,
      env: targetEnv,
      uatAlias,
      commit,
      artifactVersion,
      releaseVersion,
      lastBuildUrl,
      previewUrl,
    };
    if (args["output-json"]) {
      fs.writeFileSync(args["output-json"], JSON.stringify(summary, null, 2));
    }

    const card = buildTeamsAdaptiveCard({
      ...summary,
      prNumber: args["pr-number"] || "",
      prUrl: args["pr-url"] || "",
      author: args.author || "",
    });
    await sendTeamsNotification(card);
    console.log(`\n🎉 Full 3-Stage Pipeline SUCCEEDED! (${branch} -> ${uatAlias}/${targetEnv}, release=${releaseVersion})`);
  } catch (err) {
    console.error(`\n❌ Pipeline failed at stage=${currentStageKey}: ${err.message}`);
    const failureRecord = {
      status: "FAILURE",
      branch,
      env: targetEnv,
      uatAlias,
      commit,
      failedStage: err.stageJob || currentStageKey,
      failedStageKey: currentStageKey,
      buildNumber: err.buildNumber || "",
      buildUrl: err.buildUrl || lastBuildUrl,
      artifactVersion,
      releaseVersion,
      error: err.message,
      errorExcerpt: err.consoleTail || err.message,
    };
    if (args["output-json"]) {
      fs.writeFileSync(args["output-json"], JSON.stringify(failureRecord, null, 2));
    }

    const card = buildTeamsAdaptiveCard({
      ...failureRecord,
      prNumber: args["pr-number"] || "",
      prUrl: args["pr-url"] || "",
      author: args.author || "",
      resumeUrl: args["resume-url"] || "",
    });
    await sendTeamsNotification(card);
    process.exit(1);
  }
}

main();
