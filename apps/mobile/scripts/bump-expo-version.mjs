/**
 * Bump expo.version + package.json version (marketing / store "Version").
 * Does not change ios.buildNumber or android.versionCode — bump those in app.json per binary.
 *
 * Usage: node scripts/bump-expo-version.mjs patch|minor|major
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const appPath = join(root, "app.json");
const pkgPath = join(root, "package.json");

const kind = (process.argv[2] || "patch").toLowerCase();
if (!["patch", "minor", "major"].includes(kind)) {
  console.error('Usage: node scripts/bump-expo-version.mjs [patch|minor|major]');
  process.exit(1);
}

const app = JSON.parse(readFileSync(appPath, "utf8"));
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = app.expo?.version || pkg.version || "0.0.0";
const parts = current.split(".").map((n) => parseInt(String(n), 10) || 0);
while (parts.length < 3) parts.push(0);
const [maj, min, pat] = parts;
let next;
if (kind === "major") next = `${maj + 1}.0.0`;
else if (kind === "minor") next = `${maj}.${min + 1}.0`;
else next = `${maj}.${min}.${pat + 1}`;

app.expo.version = next;
pkg.version = next;
writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`, "utf8");
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
console.log(`Version bumped: ${current} → ${next}`);
