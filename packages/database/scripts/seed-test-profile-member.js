/**
 * Creates a test profile member with photos (posts) and badges for reviewing
 * the member profile design locally. Safe to run multiple times (upserts by email).
 *
 * Run from repo root: node packages/database/scripts/seed-test-profile-member.js
 * Or from packages/database: node scripts/seed-test-profile-member.js
 *
 * To remove later: node packages/database/scripts/delete-test-profile-member.js
 */

const path = require("path");
const fs = require("fs");

if (process.env.SEED_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.SEED_DATABASE_URL;
}

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
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const TEST_PROFILE_EMAIL = "test-profile-design@nwc.local";
const TEST_PROFILE_PASSWORD = "TestProfile123!";

// Placeholder image URLs that load (picsum)
const SAMPLE_PHOTOS = [
  "https://picsum.photos/400/400?random=1",
  "https://picsum.photos/400/400?random=2",
  "https://picsum.photos/400/400?random=3",
  "https://picsum.photos/400/400?random=4",
  "https://picsum.photos/400/400?random=5",
  "https://picsum.photos/400/400?random=6",
  "https://picsum.photos/400/400?random=7",
  "https://picsum.photos/400/400?random=8",
  "https://picsum.photos/400/400?random=9",
];

async function main() {
  const passwordHash = await bcrypt.hash(TEST_PROFILE_PASSWORD, 10);

  let member = await prisma.member.findUnique({
    where: { email: TEST_PROFILE_EMAIL },
    include: { memberBadges: { select: { badgeId: true } } },
  });

  if (!member) {
    const created = await prisma.member.create({
      data: {
        email: TEST_PROFILE_EMAIL,
        passwordHash,
        firstName: "River",
        lastName: "Sample",
        bio: "I like to hangout with my wife and my puppies.",
        city: "Coeur d'Alene",
        allTimePointsEarned: 1250,
        privacyLevel: "public",
      },
    });
    member = await prisma.member.findUnique({
      where: { email: TEST_PROFILE_EMAIL },
      include: { memberBadges: { select: { badgeId: true } } },
    });
    console.log("Created test profile member:", member.email);
  } else {
    await prisma.member.update({
      where: { id: member.id },
      data: {
        firstName: "River",
        lastName: "Sample",
        bio: "I like to hangout with my wife and my puppies.",
        city: "Coeur d'Alene",
        allTimePointsEarned: 1250,
        privacyLevel: "public",
      },
    });
    console.log("Updated test profile member:", member.email);
  }

  // Ensure very high points so they appear at top of leaderboard (balance-based and season-based)
  const leaderboardPoints = 999999;
  await prisma.member.update({
    where: { id: member.id },
    data: { points: leaderboardPoints },
  });

  const now = new Date();
  let currentSeason = await prisma.season.findFirst({
    where: { startDate: { lte: now }, endDate: { gte: now } },
    select: { id: true, name: true },
  });
  if (!currentSeason) {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 1);
    const end = new Date(now);
    end.setFullYear(end.getFullYear() + 1);
    currentSeason = await prisma.season.create({
      data: {
        name: "Season 1",
        startDate: start,
        endDate: end,
      },
      select: { id: true, name: true },
    });
    console.log("Created current season for leaderboard:", currentSeason.name);
  }
  await prisma.memberSeasonPoints.upsert({
    where: { memberId_seasonId: { memberId: member.id, seasonId: currentSeason.id } },
    create: { memberId: member.id, seasonId: currentSeason.id, pointsEarned: leaderboardPoints },
    update: { pointsEarned: leaderboardPoints },
  });
  console.log("Added test profile member to leaderboard (points:", leaderboardPoints + ")");

  // Ensure subscribe so they can use app
  let sub = await prisma.subscription.findFirst({
    where: { memberId: member.id, plan: "subscribe" },
  });
  if (!sub) {
    await prisma.subscription.create({
      data: { memberId: member.id, plan: "subscribe", status: "active" },
    });
    console.log("Added subscribe plan to test profile member");
  }

  // Member badges: link to existing member badges (community_member, og_community_member, etc.)
  const badgeSlugs = ["community_member", "og_community_member", "spreading_the_word", "community_writer", "super_scanner"];
  const badges = await prisma.badge.findMany({
    where: { slug: { in: badgeSlugs } },
    select: { id: true, slug: true },
  });
  const existingBadgeIds = new Set((member.memberBadges || []).map((mb) => mb.badgeId));
  for (const badge of badges) {
    if (!existingBadgeIds.has(badge.id)) {
      await prisma.memberBadge.create({
        data: { memberId: member.id, badgeId: badge.id, displayOnProfile: true },
      });
      console.log("Awarded badge:", badge.slug);
    }
  }

  // Posts with photos (so "Posted Photos" grid and zoom work)
  const existingPosts = await prisma.post.findMany({
    where: { authorId: member.id },
    select: { id: true },
  });
  if (existingPosts.length >= 6) {
    console.log("Test member already has", existingPosts.length, "posts");
  } else {
    const postsToCreate = [
      { content: "Sunset at the lake 🌅", photos: [SAMPLE_PHOTOS[0], SAMPLE_PHOTOS[1]] },
      { content: "Weekend hike with the family.", photos: [SAMPLE_PHOTOS[2]] },
      { content: "Coffee and a good book.", photos: [SAMPLE_PHOTOS[3], SAMPLE_PHOTOS[4], SAMPLE_PHOTOS[5]] },
      { content: "Local farmers market finds.", photos: [SAMPLE_PHOTOS[6]] },
      { content: "Puppy nap time.", photos: [SAMPLE_PHOTOS[7]] },
      { content: "Supporting local!", photos: [SAMPLE_PHOTOS[8]] },
    ];
    for (const p of postsToCreate) {
      await prisma.post.create({
        data: {
          authorId: member.id,
          type: "personal",
          content: p.content,
          photos: p.photos,
          videos: [],
        },
      });
    }
    console.log("Created", postsToCreate.length, "posts with photos for test profile member");
  }

  // Optional: add a saved business so "Favorite businesses" section shows
  const firstBusiness = await prisma.business.findFirst({
    where: { slug: "djs-coins-collectibles" },
    select: { id: true },
  });
  if (firstBusiness) {
    const existing = await prisma.savedItem.findFirst({
      where: { memberId: member.id, type: "business", referenceId: firstBusiness.id },
    });
    if (!existing) {
      await prisma.savedItem.create({
        data: { memberId: member.id, type: "business", referenceId: firstBusiness.id },
      });
      console.log("Added favorite business for test profile member");
    }
  }

  console.log("\n--- Test profile member ready ---");
  console.log("Email:", TEST_PROFILE_EMAIL);
  console.log("Password:", TEST_PROFILE_PASSWORD);
  console.log("Member ID (for URL):", member.id);
  console.log("In the app, open: /members/" + member.id);
  console.log("\nTo delete this member later, run:");
  console.log("  node packages/database/scripts/delete-test-profile-member.js");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
