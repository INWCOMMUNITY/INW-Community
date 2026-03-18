/**
 * Verify the test profile member appears in the leaderboard (same logic as API).
 * Run from repo root: node packages/database/scripts/verify-leaderboard.js
 * Or from packages/database: node scripts/verify-leaderboard.js
 */

const path = require("path");
const fs = require("fs");

if (process.env.SEED_DATABASE_URL) process.env.DATABASE_URL = process.env.SEED_DATABASE_URL;
const possibleRoots = [
  path.resolve(__dirname, "..", "..", "..", ".env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
];
const rootEnvPath = possibleRoots.find((p) => fs.existsSync(p));
if (rootEnvPath) {
  try {
    require("dotenv").config({ path: rootEnvPath });
  } catch {
    const content = fs.readFileSync(rootEnvPath, "utf8");
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
const prisma = new PrismaClient();

const TEST_EMAIL = "test-profile-design@nwc.local";

async function main() {
  const member = await prisma.member.findUnique({
    where: { email: TEST_EMAIL },
    select: { id: true, firstName: true, lastName: true, points: true },
  });
  if (!member) {
    console.log("Test profile member NOT FOUND in database (email:", TEST_EMAIL + ")");
    console.log("Run: pnpm --filter database run seed:test-profile");
    return;
  }
  console.log("Test member in DB:", member.firstName, member.lastName, "| points (balance):", member.points);

  const now = new Date();
  const season = await prisma.season.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
    select: { id: true, name: true },
  });

  if (season) {
    const msp = await prisma.memberSeasonPoints.findUnique({
      where: { memberId_seasonId: { memberId: member.id, seasonId: season.id } },
      select: { pointsEarned: true },
    });
    console.log("Current season:", season.name, "| test member season points:", msp?.pointsEarned ?? "NONE");
    const top = await prisma.memberSeasonPoints.findMany({
      where: { seasonId: season.id, pointsEarned: { gt: 0 } },
      orderBy: { pointsEarned: "desc" },
      take: 10,
      include: { member: { select: { id: true, firstName: true, lastName: true } } },
    });
    console.log("\nTop 10 leaderboard (season):");
    top.forEach((r, i) => {
      const isTest = r.member.id === member.id;
      console.log("  " + (i + 1) + ".", r.member.firstName, r.member.lastName, "-", r.pointsEarned, isTest ? " <-- TEST MEMBER" : "");
    });
    const inTop = top.some((r) => r.member.id === member.id);
    if (!inTop) console.log("\nTest member is NOT in top 10. Add more season points via seed:test-profile.");
  } else {
    console.log("No current season; leaderboard uses balance.");
    const top = await prisma.member.findMany({
      where: { points: { gt: 0 } },
      select: { id: true, firstName: true, lastName: true, points: true },
      orderBy: { points: "desc" },
      take: 10,
    });
    console.log("\nTop 10 leaderboard (balance):");
    top.forEach((r, i) => {
      const isTest = r.id === member.id;
      console.log("  " + (i + 1) + ".", r.firstName, r.lastName, "-", r.points, isTest ? " <-- TEST MEMBER" : "");
    });
    const inTop = top.some((r) => r.id === member.id);
    if (!inTop) console.log("\nTest member is NOT in top 10. Add more points via seed:test-profile.");
  }

  console.log("\nDATABASE_URL (first 50 chars):", (process.env.DATABASE_URL || "").slice(0, 50) + "...");
  console.log("\nIf test member is above but not in the app:");
  console.log("  1. Start the main app: pnpm dev:main (or pnpm dev) so the API runs.");
  console.log("  2. From this machine, try: curl \"http://localhost:3000/api/rewards/leaderboard?limit=10\"");
  console.log("  3. In the app, use the same IP as EXPO_PUBLIC_API_URL (e.g. http://YOUR_IP:3000), pull-to-refresh the leaderboard.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
