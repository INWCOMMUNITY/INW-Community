#!/usr/bin/env node
/**
 * Create or update the admin login user in the database.
 * Only touches the admin user - no other seed data.
 *
 * Usage (PowerShell, from repo root):
 *   $env:DATABASE_URL="postgresql://user:pass@host:5432/db"
 *   $env:ADMIN_EMAIL="youradmin@example.com"
 *   $env:ADMIN_INITIAL_PASSWORD="YourSecurePass123!"
 *   pnpm db:seed-admin
 *
 * Or set those in root .env and run: pnpm db:seed-admin
 */
const path = require("path");
const fs = require("fs");

const rootEnv = path.resolve(__dirname, "..", "..", "..", ".env");
if (fs.existsSync(rootEnv)) {
  try {
    require("dotenv").config({ path: rootEnv });
  } catch {
    // dotenv not available – parse manually
    const content = fs.readFileSync(rootEnv, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) {
        const key = m[1].trim();
        const val = m[2].trim().replace(/^["']|["']$/g, "");
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
}

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error("Missing ADMIN_EMAIL or ADMIN_INITIAL_PASSWORD.");
    console.error("Set in root .env, or: $env:ADMIN_EMAIL='x'; $env:ADMIN_INITIAL_PASSWORD='y'");
    process.exit(1);
  }

  const email = adminEmail.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.member.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      firstName: "Admin",
      lastName: "User",
      city: "",
    },
    update: { passwordHash },
  });

  console.log("Admin user created/updated successfully.");
  console.log("  Log in at /login with:");
  console.log("  Email:", email);
  console.log("  Password: (your ADMIN_INITIAL_PASSWORD value)");
  console.log("");
  console.log("Ensure ADMIN_EMAIL is set in Vercel for the main app.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
