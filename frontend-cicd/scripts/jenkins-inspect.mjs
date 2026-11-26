#!/usr/bin/env node
/**
 * Compliant READ-ONLY Jenkins CLI inspector for Enterprise Copilot CLI / Desktop
 * (ZERO MCP required — runs as a normal audited workspace command).
 *
 * Usage:
 *   node scripts/jenkins-inspect.mjs status [--branch develop-202701]
 *   node scripts/jenkins-inspect.mjs log --job dev/react-demo-ci [--build lastFailedBuild] [--tail 80] [--grep "error|fail"]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_PATH = path.resolve(__dirname, "../config/branch-env-map.json");

function parseArgs(argv) {
  const cmd = argv[0] || "status";
  const args = { cmd };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const k = argv[i].slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[k] = true;
      } else {
        args[k] = next;
        i++;
      }
    }
  }
  return args;
}

function toJenkinsJobPath(logicalPath) {
  return logicalPath
    .split("/")
    .filter(Boolean)
    .map((seg) => `job/${encodeURIComponent(seg)}`)
    .join("/");
}

function loadCreds() {
  const url = (process.env.JENKINS_URL || "http://localhost:8088").replace(/\/+$/, "");
  const user = process.env.JENKINS_USER || "dev-bot";
  let token = (process.env.JENKINS_API_TOKEN || "").trim();
  if (!token) {
    // Optional local sandbox fallback (never committed to git)
    const sandboxToken = path.resolve(__dirname, "../../../jenkins-local/jenkins_home/dev-bot-token.txt");
    if (fs.existsSync(sandboxToken)) {
      token = fs.readFileSync(sandboxToken, "utf8").trim();
    }
  }
  if (!token) {
    throw new Error("Please export JENKINS_API_TOKEN (and JENKINS_URL / JENKINS_USER) in your local shell.");
  }
  return { url, auth: `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}` };
}

function extractParams(actions = []) {
  const out = {};
  for (const a of actions || []) {
    if (a && Array.isArray(a.parameters)) {
      for (const p of a.parameters) out[p.name] = p.value;
    }
  }
  return out;
}

async function cmdStatus(args) {
  const { url, auth } = loadCreds();
  const config = JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
  const branch = args.branch;
  const mapping = branch ? config.branchToEnv[branch] : null;

  const jobs = Object.entries(config.jenkinsJobs);
  const report = [];
  for (const [stage, logicalJob] of jobs) {
    const jobPath = toJenkinsJobPath(logicalJob);
    const res = await fetch(
      `${url}/${jobPath}/api/json?tree=builds[number,building,result,url,actions[parameters[name,value],causes[userName]]]{0,3}`,
      { headers: { Authorization: auth } }
    );
    if (!res.ok) {
      report.push({ stage, job: logicalJob, error: `HTTP ${res.status}` });
      continue;
    }
    const data = await res.json();
    const recent = (data.builds || []).map((b) => ({
      number: b.number,
      building: b.building,
      result: b.building ? "RUNNING" : b.result,
      params: extractParams(b.actions),
      url: b.url,
    }));
    report.push({ stage, job: logicalJob, recentBuilds: recent });
  }

  console.log(
    JSON.stringify(
      {
        jenkinsUrl: url,
        ...(branch ? { branch, mappedEnv: mapping || "UNMAPPED" } : {}),
        stages: report,
      },
      null,
      2
    )
  );
}

async function cmdLog(args) {
  const { url, auth } = loadCreds();
  if (!args.job) {
    throw new Error("Missing --job (e.g. --job dev/react-demo-ci)");
  }
  const jobPath = toJenkinsJobPath(args.job);
  const build = args.build || "lastBuild";
  const tail = Math.min(Math.max(Number(args.tail || 80), 1), 300);

  const res = await fetch(`${url}/${jobPath}/${encodeURIComponent(build)}/consoleText`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch log for ${args.job} #${build}: HTTP ${res.status}`);
  }
  const lines = (await res.text()).split("\n");
  let selected = lines;
  if (args.grep) {
    const regex = new RegExp(args.grep, "i");
    selected = lines
      .map((line, i) => ({ line, num: i + 1 }))
      .filter((x) => regex.test(x.line))
      .map((x) => `L${x.num}: ${x.line}`);
  }
  console.log(selected.slice(-tail).join("\n"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cmd === "status") {
    await cmdStatus(args);
  } else if (args.cmd === "log") {
    await cmdLog(args);
  } else {
    console.error("Usage: jenkins-inspect.mjs <status|log> [options]");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
