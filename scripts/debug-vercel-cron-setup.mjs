import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
let token = "";
for (const line of readFileSync(join(rootDir, ".env"), "utf8").split(/\n/)) {
  const m = line.match(/^VERCEL_TOKEN\s*=\s*["']?([^"'\s]+)["']?/);
  if (m) token = m[1].trim();
}
if (!token) {
  console.error("NO_TOKEN");
  process.exit(1);
}

const auth = { Authorization: `Bearer ${token}` };

async function getJson(path) {
  const res = await fetch(`https://api.vercel.com${path}`, { headers: auth });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

const project = await getJson("/v9/projects/INW-Community");
console.log(
  JSON.stringify(
    {
      projectStatus: project.status,
      name: project.json.name,
      id: project.json.id,
      accountId: project.json.accountId,
      framework: project.json.framework,
      crons: project.json.crons ?? project.json.cron ?? null,
    },
    null,
    2
  )
);

const env = await getJson("/v9/projects/INW-Community/env");
const keys = (env.json.envs || [])
  .map((e) => e.key)
  .filter(Boolean)
  .sort();
console.log("env_status", env.status);
console.log("has_CRON_SECRET", keys.includes("CRON_SECRET"));
console.log("has_CHANNEL_CRON_SYNC_ENABLED", keys.includes("CHANNEL_CRON_SYNC_ENABLED"));
console.log("has_EBAY_WEBHOOK_SECRET", keys.includes("EBAY_WEBHOOK_SECRET"));
console.log(
  "interesting_env_keys",
  keys.filter((k) => /CRON|EBAY|CHANNEL|ENCRYPTION|NEXTAUTH/i.test(k))
);

const teamQs = project.json.accountId ? `&teamId=${project.json.accountId}` : "";
const deps = await getJson(`/v6/deployments?projectId=INW-Community&limit=5${teamQs}`);
const list = (deps.json.deployments || []).map((d) => ({
  uid: d.uid,
  state: d.state,
  created: d.created,
  url: d.url,
  sha: d.meta?.githubCommitSha,
  message: d.meta?.githubCommitMessage,
}));
console.log("deployments", JSON.stringify(list, null, 2));
