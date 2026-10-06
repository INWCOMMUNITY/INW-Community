import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { createHash, createDecipheriv } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(path.join(root, "packages/database/package.json"));
const { PrismaClient } = require("@prisma/client");

function loadEnv(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, "")];
      })
  );
}

const env = loadEnv(path.join(root, ".env"));
for (const [k, v] of Object.entries(env)) process.env[k] = v;

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (Buffer.byteLength(raw, "utf8") === 32 && raw.length === 32) return Buffer.from(raw, "utf8");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(raw, "utf8").digest();
}

function decrypt(ciphertext) {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 16));
  decipher.setAuthTag(buf.subarray(16, 32));
  return decipher.update(buf.subarray(32)).toString("utf8") + decipher.final("utf8");
}

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const conn = await prisma.etsyConnection.findFirst({ where: { status: "ACTIVE" } });
const token = decrypt(conn.accessTokenEncrypted);
const apiKey = (process.env.ETSY_API_KEY || "").trim();
const secret = (process.env.ETSY_CLIENT_SECRET || "").trim();
const listingId = "4586604968";

console.log({
  apiKeyLen: apiKey.length,
  secretLen: secret.length,
  apiKeyPrefix: apiKey.slice(0, 6),
  shopId: conn.shopId,
  tokenExp: conn.accessTokenExpiresAt,
  now: new Date().toISOString(),
});

const paths = [
  `/listings/${listingId}`,
  `/shops/${conn.shopId}/listings/${listingId}`,
  `/listings/${listingId}/inventory`,
];
for (const pathSuffix of paths) {
  const res = await fetch(`https://openapi.etsy.com/v3/application${pathSuffix}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": `${apiKey}:${secret}`,
    },
  });
  const text = await res.text();
  console.log(pathSuffix, res.status, text.slice(0, 400));
}

await prisma.$disconnect();
