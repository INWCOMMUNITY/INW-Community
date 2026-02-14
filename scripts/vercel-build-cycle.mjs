#!/usr/bin/env node
/**
 * Full Vercel build cycle: commit+push -> wait for build -> fetch logs
 * Run: node scripts/vercel-build-cycle.mjs
 * Exits 0 on success (READY), 1 on failure (ERROR)
 * Use in a loop: fix errors, run again, until success
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const POLL_INTERVAL_MS = 20000; // 20 seconds
const MAX_WAIT_MS = 15 * 60 * 1000; // 15 minutes

function loadEnv() {
  try {
    const content = readFileSync(join(rootDir, ".env"), "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^VERCEL_TOKEN\s*=\s*["']?([^"'\s]+)["']?/);
      if (m) return m[1].trim();
    }
  } catch (e) {}
  return process.env.VERCEL_TOKEN;
}

const token = loadEnv();
if (!token) {
  console.error("VERCEL_TOKEN not found in .env");
  process.exit(1);
}

const PROJECT = "INW-Community";

async function fetchApi(path) {
  const res = await fetch(`https://api.vercel.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchEvents(deploymentId) {
  const res = await fetch(
    `https://api.vercel.com/v3/deployments/${deploymentId}/events?limit=-1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Events API ${res.status}`);
  return res.json();
}

function run(cmd, opts = {}) {
  return execSync(cmd, {
    cwd: rootDir,
    encoding: "utf8",
    ...opts,
  });
}

async function main() {
  // 1. Check for uncommitted changes and push
  let status;
  try {
    status = run("git status --porcelain");
  } catch (e) {
    console.error("Git status failed:", e.message);
    process.exit(1);
  }

  if (status.trim()) {
    console.log("Uncommitted changes detected. Committing and pushing...");
    try {
      run('git add -A');
      run('git commit -m "fix: address Vercel build errors"');
      run("git push");
    } catch (e) {
      console.error("Git push failed:", e.message);
      process.exit(1);
    }
    console.log("Pushed. Waiting 10s for Vercel to pick up...");
    await new Promise((r) => setTimeout(r, 10000));
  } else {
    console.log("No uncommitted changes. Checking latest deployment...");
  }

  // 2. Get current commit SHA
  let headSha;
  try {
    headSha = run("git rev-parse HEAD").trim();
  } catch (e) {
    console.error("Could not get HEAD sha");
    process.exit(1);
  }
  console.log("Current commit:", headSha.slice(0, 7));

  // 3. Poll for deployment matching our commit
  const start = Date.now();
  let deployment;

  while (Date.now() - start < MAX_WAIT_MS) {
    const { deployments } = await fetchApi(
      `/v6/deployments?projectId=${encodeURIComponent(PROJECT)}&limit=3`
    );

    if (!deployments?.length) {
      console.log("No deployments yet, waiting...");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    // Find deployment for our commit (compare first 7 chars - short sha)
    const shortSha = headSha.slice(0, 7);
    deployment = deployments.find(
      (d) => (d.meta?.githubCommitSha || "").slice(0, 7) === shortSha
    ) || deployments[0];

    const commitMatch = (deployment.meta?.githubCommitSha || "").slice(0, 7) === shortSha;
    if (!commitMatch && status.trim()) {
      console.log("Waiting for deployment of our commit...");
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    const { state, uid } = deployment;
    console.log(`Deployment ${uid.slice(0, 12)}... state: ${state}`);

    if (state === "READY") {
      console.log("\n✓ Build succeeded!");
      const events = await fetchEvents(uid);
      const eventList = Array.isArray(events) ? events : events.events || events.data || [];
      const lines = eventList
        .filter((e) => e.text || e.payload?.text || e.message)
        .map((e) => e.text ?? e.payload?.text ?? e.message ?? "")
        .filter(Boolean)
        .join("\n");
      writeFileSync(
        join(rootDir, "last-vercel-build.log"),
        `Deployment: ${uid}\nState: READY\n\n--- Build Log ---\n\n${lines || "No log lines"}`,
        "utf8"
      );
      process.exit(0);
    }

    if (state === "ERROR" || state === "CANCELED") {
      console.log(`\n✗ Build failed (${state})`);
      const events = await fetchEvents(uid);
      const eventList = Array.isArray(events) ? events : events.events || events.data || [];
      const lines = eventList
        .filter((e) => e.text || e.payload?.text || e.message)
        .map((e) => e.text ?? e.payload?.text ?? e.message ?? "")
        .filter(Boolean)
        .join("\n");
      const full = `Deployment: ${uid}\nState: ${state}\n\n--- Build Log ---\n\n${lines || "No log lines"}`;
      writeFileSync(join(rootDir, "last-vercel-build.log"), full, "utf8");
      console.log("Saved to last-vercel-build.log");
      process.exit(1);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  console.error("Timeout waiting for build");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
