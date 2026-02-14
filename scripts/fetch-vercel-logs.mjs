#!/usr/bin/env node
/**
 * Fetches the latest Vercel deployment build logs and saves to last-vercel-build.log
 * Requires VERCEL_TOKEN in .env
 * Run: node scripts/fetch-vercel-logs.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Load VERCEL_TOKEN from .env
function loadEnv() {
  try {
    const envPath = join(rootDir, ".env");
    const content = readFileSync(envPath, "utf8");
    for (const line of content.split("\n")) {
      const m = line.match(/^VERCEL_TOKEN\s*=\s*["']?([^"'\s]+)["']?/);
      if (m) return m[1].trim();
    }
  } catch (e) {
    // ignore
  }
  return process.env.VERCEL_TOKEN;
}

const token = loadEnv();
if (!token) {
  console.error("VERCEL_TOKEN not found. Add it to .env or set the environment variable.");
  process.exit(1);
}

const PROJECT = "INW-Community"; // or your Vercel project name

async function fetchApi(path, opts = {}) {
  const url = `https://api.vercel.com${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...opts.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function streamEvents(deploymentId) {
  // v3 supports limit=-1 for all events
  const url = `https://api.vercel.com/v3/deployments/${deploymentId}/events?limit=-1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Events API ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data;
}

async function main() {
  // 1. List deployments for project
  const { deployments } = await fetchApi(
    `/v6/deployments?projectId=${encodeURIComponent(PROJECT)}&limit=5`
  );

  if (!deployments?.length) {
    console.error("No deployments found for project:", PROJECT);
    process.exit(1);
  }

  const latest = deployments[0];
  const { uid, state, url: deployUrl, meta } = latest;
  console.log(`Latest deployment: ${uid} (${state})`);
  if (meta?.githubCommitSha) {
    console.log(`Commit: ${meta.githubCommitSha}`);
  }

  // 2. Fetch deployment events (build logs)
  let events;
  try {
    events = await streamEvents(uid);
  } catch (e) {
    console.error("Could not fetch events:", e.message);
    process.exit(1);
  }

  // Events can be array or object with events
  const eventList = Array.isArray(events) ? events : events.events || events.data || [];
  const lines = eventList
    .filter((e) => e.text || e.payload?.text || e.message)
    .map((e) => {
      const t = e.text ?? e.payload?.text ?? e.message;
      return typeof t === "string" ? t : JSON.stringify(t);
    })
    .join("\n");

  if (!lines.trim()) {
    // Try alternative format - some APIs return different structure
    const raw = JSON.stringify(events, null, 2);
    const fallback = `Deployment: ${uid}\nState: ${state}\n\nRaw response (first 5000 chars):\n${raw.slice(0, 5000)}`;
    writeFileSync(join(rootDir, "last-vercel-build.log"), fallback);
    console.log("Saved raw response to last-vercel-build.log (events format may differ)");
  } else {
    const full = `Deployment: ${uid}\nState: ${state}\nURL: ${deployUrl || "N/A"}\n\n--- Build Log ---\n\n${lines}`;
    writeFileSync(join(rootDir, "last-vercel-build.log"), full);
    console.log("Saved build log to last-vercel-build.log");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
