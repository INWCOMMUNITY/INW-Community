const path = require("path");
const fs = require("fs");

// Load root .env so DATABASE_URL is shared with main when both use the same DB
const rootEnv = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(rootEnv)) {
  const content = fs.readFileSync(rootEnv, "utf8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["database", "types"],
};

module.exports = nextConfig;
