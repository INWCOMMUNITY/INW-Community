/**
 * Load monorepo env so `pnpm dev:realtime` sees DATABASE_URL, NEXTAUTH_SECRET, etc.
 *
 * 1) Root `.env` — set any key that is still `undefined` (same idea as before).
 * 2) In development, `NEXTAUTH_SECRET` is also read from `apps/main/.env` then
 *    `apps/main/.env.local` (later wins). Next.js loads those files for the API;
 *    if realtime only used root `.env`, Socket.IO JWT verification could disagree
 *    with the secret that signed the mobile Bearer token → `invalid token`.
 */
import fs from "fs";
import path from "path";

const rootEnv = path.join(__dirname, "..", "..", "..", ".env");
const isDev = process.env.NODE_ENV !== "production";

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key) out[key] = val;
    }
  }
  return out;
}

if (fs.existsSync(rootEnv)) {
  const content = fs.readFileSync(rootEnv, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

if (isDev) {
  const mainDir = path.join(__dirname, "..", "..", "main");
  const fromMain = { ...parseEnvFile(path.join(mainDir, ".env")), ...parseEnvFile(path.join(mainDir, ".env.local")) };
  const secret = fromMain.NEXTAUTH_SECRET?.trim();
  if (secret) {
    process.env.NEXTAUTH_SECRET = secret;
  }
}
