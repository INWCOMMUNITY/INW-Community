const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

// Load root .env so ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD are available (monorepo)
const possibleRoots = [
  path.resolve(__dirname, "..", "..", "..", ".env"), // from packages/database/prisma
  path.resolve(process.cwd(), "..", ".env"), // from packages/database cwd
  path.resolve(process.cwd(), "..", "..", ".env"), // if cwd is packages/database/prisma
];
const rootEnvPath = possibleRoots.find((p) => fs.existsSync(p));
if (rootEnvPath) {
  try {
    require("dotenv").config({ path: rootEnvPath });
  } catch {
    // Fallback: manual parse if dotenv not available
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

const prisma = new PrismaClient();

async function main() {
  // Admin user – created when ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD are set (one-time setup)
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (adminEmail && adminPassword) {
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
    console.log("Created/updated admin login:", email);
    if (adminPassword.includes("<") || adminPassword.includes(">")) {
      console.log("  Note: Your password includes angle brackets - type them exactly when logging in.");
    }
    console.log("  (Remove ADMIN_INITIAL_PASSWORD from .env after first seed)");
  }

  // Sponsor members for pnwcommunity.com business directory (max 2 businesses per sponsor)
  const SPONSOR_EMAILS = [
    "sponsor@nwc.local",
    "sponsor2@nwc.local",
    "sponsor3@nwc.local",
    "sponsor4@nwc.local",
    "sponsor5@nwc.local",
    "sponsor6@nwc.local",
  ];
  const sponsorPassword = "Sponsor123!";
  const sponsorMembers = [];
  const sponsorNames = {
    "sponsor@nwc.local": { firstName: "Example", lastName: "Business" },
    "sponsor2@nwc.local": { firstName: "Sponsor", lastName: "2" },
    "sponsor3@nwc.local": { firstName: "Sponsor", lastName: "3" },
    "sponsor4@nwc.local": { firstName: "Sponsor", lastName: "4" },
    "sponsor5@nwc.local": { firstName: "Sponsor", lastName: "5" },
    "sponsor6@nwc.local": { firstName: "Sponsor", lastName: "6" },
  };
  for (const email of SPONSOR_EMAILS) {
    let m = await prisma.member.findUnique({ where: { email } });
    if (!m) {
      const passwordHash = await bcrypt.hash(sponsorPassword, 10);
      const names = sponsorNames[email] || { firstName: "Sponsor", lastName: "" };
      m = await prisma.member.create({
        data: {
          email,
          passwordHash,
          firstName: names.firstName,
          lastName: names.lastName,
          city: "Coeur d'Alene",
        },
      });
      console.log("Created sponsor login:", m.email, "(password: " + sponsorPassword + ")");
    }
    let sub = await prisma.subscription.findFirst({
      where: { memberId: m.id, plan: "sponsor" },
    });
    if (!sub) {
      await prisma.subscription.create({
        data: { memberId: m.id, plan: "sponsor", status: "active" },
      });
      console.log("Created sponsor subscription for", m.email);
    }
    sponsorMembers.push(m);
  }
  const sponsorByEmail = Object.fromEntries(sponsorMembers.map((m) => [m.email, m]));
  const member = sponsorByEmail["sponsor@nwc.local"];

  const SPONSOR_BUSINESSES = [
    {
      memberEmail: "sponsor@nwc.local",
      slug: "northwest-community",
      name: "Northwest Community",
      shortDescription: "Community Page incentivizing supporting local!",
      fullDescription:
        "Started in 2025 we are a startup. Northwest Community connects Eastern Washington & North Idaho residents with local businesses through our directory, coupons, events, and storefront.",
      website: "https://pnwcommunity.com",
      phone: "208-819-0268",
      email: "donivan@pnwcommunity.com",
      address: "3650 N Government Way, Coeur d'Alene, ID 83815",
      city: "Coeur d'Alene",
      categories: ["Community"],
      hoursOfOperation: {
        sunday: "CLOSED",
        monday: "8:00-3:00",
        tuesday: "8:00-3:00",
        wednesday: "8:00-3:00",
        thursday: "8:00-3:00",
        friday: "8:00-3:00",
        saturday: "CLOSED",
      },
      logoUrl: "/nwc-logo-circle.png",
      photos: [],
    },
    {
      memberEmail: "sponsor@nwc.local",
      slug: "djs-coins-collectibles",
      name: "DJs Coins & Collectibles",
      shortDescription:
        "Family owned coin shop in Coeur d' Alene. Buying & Selling Gold & Silver! Numismatic collections, supplies, jewelry, comic books, records, and more!",
      fullDescription:
        "DJs Coins is a family owned Coin and Bullion shop located in Coeur D Alene, Idaho. With Over 25 years in business, DJs is a sure fire way to become educated about, and to buy and sell your coins!",
      website: "https://example.com",
      phone: "208-664-9771",
      email: "djscoins@hotmail.com",
      address: "3650 N Government Wy Ste F, Coeur d'Alene, ID 83815",
      city: "Coeur d'Alene",
      categories: ["Retail"],
      hoursOfOperation: {
        sunday: "CLOSED",
        monday: "9:30-5:00",
        tuesday: "9:30-5:00",
        wednesday: "9:30-5:00",
        thursday: "9:30-5:00",
        friday: "9:30-3:00",
        saturday: "CLOSED",
      },
      logoUrl:
        "https://static.wixstatic.com/media/2bdd49_547da7a129704e16be9263c35822a2a4~mv2.jpg/v1/fill/w_400,h_400,al_c,q_80,enc_avif,quality_auto/eeeee861d3be78f34739314f83d3a5f0_edited.jpg",
      photos: [
        "https://static.wixstatic.com/media/2bdd49_547da7a129704e16be9263c35822a2a4~mv2.jpg/v1/fill/w_600,h_600,al_c,q_85,enc_avif,quality_auto/0023_22a.jpg",
        "https://static.wixstatic.com/media/2bdd49_2fa6bb1636484e0eb2bee8348d7ecd41~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_2fa6bb1636484e0eb2bee8348d7ecd41~mv2.webp",
        "https://static.wixstatic.com/media/2bdd49_d16bfd51c06e409994284b5c6a9f7f14~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_d16bfd51c06e409994284b5c6a9f7f14~mv2.webp",
        "https://static.wixstatic.com/media/2bdd49_9f1fdb0897de4ac091366c2cfdff53f5~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_9f1fdb0897de4ac091366c2cfdff53f5~mv2.webp",
        "https://static.wixstatic.com/media/2bdd49_dcddd7f7f6b642febe8118f45b232ea9~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_dcddd7f7f6b642febe8118f45b232ea9~mv2.webp",
        "https://static.wixstatic.com/media/2bdd49_af5e9b51952f4248b54463f80f899912~mv2.webp/v1/fit/w_779,h_782,q_90,enc_avif,quality_auto/2bdd49_af5e9b51952f4248b54463f80f899912~mv2.webp",
        "https://static.wixstatic.com/media/2bdd49_4ad6fc4507454d819d5f361b2038256b~mv2.webp/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_4ad6fc4507454d819d5f361b2038256b~mv2.webp",
        "https://static.wixstatic.com/media/2bdd49_1d9f85617ef746b8a490fb0b801e87ce~mv2.webp/v1/fit/w_780,h_780,q_90,enc_avif,quality_auto/2bdd49_1d9f85617ef746b8a490fb0b801e87ce~mv2.webp",
        "https://static.wixstatic.com/media/2bdd49_4b30e3e892ad4438823a7c8f9afad055~mv2.webp/v1/fit/w_780,h_780,q_90,enc_avif,quality_auto/2bdd49_4b30e3e892ad4438823a7c8f9afad055~mv2.webp",
        "https://static.wixstatic.com/media/2bdd49_99aafbc9303c442f92004ba43e5fe83c~mv2.webp/v1/fit/w_780,h_780,q_90,enc_avif,quality_auto/2bdd49_99aafbc9303c442f92004ba43e5fe83c~mv2.webp",
      ],
    },
    {
      memberEmail: "sponsor@nwc.local",
      slug: "dualspan",
      name: "DualSpan",
      shortDescription:
        "DualSpan provides mobile aviation maintenance and reliable handyman services throughout Eastern Washington, bringing professional precision, integrity, and craftsmanship to every job — in the air and at home.",
      fullDescription:
        "DualSpan is a locally owned service business serving the greater Spokane and Eastern Washington area with both mobile aviation maintenance and handyman/home repair services.\n\nFounded by Stephen Ulrich, an FAA-certified A&P Mechanic, DualSpan is built on a professional background where precision, documentation, and accountability are essential. While aviation and home projects carry different levels of risk, the disciplined approach developed through aircraft maintenance — careful planning, attention to detail, and doing the job correctly — shapes the way every service is approached.\n\nThe name DualSpan reflects the two areas of service. On one side, Stephen provides dependable aviation maintenance support for aircraft owners. On the other, DualSpan offers skilled handyman services backed by experience across multiple home-building trades.\n\nWhat sets DualSpan apart is not just versatility, but mindset. Aviation work demands consistency, responsibility, and respect for safety — values that carry into every home project, whether large or small.\n\nPrecision for the sky. Excellence in your home.\n\nDualSpan is committed to serving the local community with honesty, reliability, and quality workmanship you can trust.",
      website: "https://www.instagram.com/dualspanhandymanservices",
      phone: "984-229-0543",
      email: "dualspanservices@gmail.com",
      address: null,
      city: "Spokane",
      categories: ["Aviation Service", "Handyman"],
      hoursOfOperation: {
        sunday: "Emergency Only",
        monday: "8:00-5:00",
        tuesday: "8:00-5:00",
        wednesday: "8:00-5:00",
        thursday: "8:00-5:00",
        friday: "8:00-5:00",
        saturday: "Emergency Only",
      },
      logoUrl:
        "https://static.wixstatic.com/media/2bdd49_74fdc8ba20b34b2b88df062bfe47373e~mv2.jpeg/v1/fill/w_400,h_400,al_c,q_80,enc_avif,quality_auto/eeeee861d3be78f34739314f83d3a5f0_edited.jpeg",
      photos: [
        "https://static.wixstatic.com/media/2bdd49_74fdc8ba20b34b2b88df062bfe47373e~mv2.jpeg/v1/fill/w_600,h_600,al_c,q_85,enc_avif,quality_auto/624b82_8d924931cc784c22910dae9a49c1b231~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_b185f1b3f2654b0babd7228efdcf4c29~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_b185f1b3f2654b0babd7228efdcf4c29~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_0cf67c7a05614afdad5abc79051bda77~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_0cf67c7a05614afdad5abc79051bda77~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_88ade6dc4e6f461599d6f2085962994a~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_88ade6dc4e6f461599d6f2085962994a~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_790fb2f7298c467bacbda6ca17a4efbe~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_790fb2f7298c467bacbda6ca17a4efbe~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_46603c7b6aa947d78b13db4746db1163~mv2.jpeg/v1/fit/w_960,h_964,q_90,enc_avif,quality_auto/2bdd49_46603c7b6aa947d78b13db4746db1163~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_56b61ce770c048d49eb401cc8192761d~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_56b61ce770c048d49eb401cc8192761d~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_6cd62e45faee49d68481dae78f567706~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_6cd62e45faee49d68481dae78f567706~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_32dcebf5cc654d2e80373596a1aab7f9~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_32dcebf5cc654d2e80373596a1aab7f9~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_2d14d955386f4a31af5e16996be6a505~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_2d14d955386f4a31af5e16996be6a505~mv2.jpeg",
      ],
    },
    {
      memberEmail: "sponsor2@nwc.local",
      slug: "farmhands",
      name: "Farmhands",
      shortDescription: "Natural & Non-Greasy Hand Cream",
      fullDescription:
        "A hand cream company out of Camano Island, WA / Sandpoint, ID. Natural, organic and non-GMO ingredients. We started on Camano Island and moved the operation to Sandpoint ID.",
      website: "https://farmhandsco.com",
      phone: "208-568-0467",
      email: "info@farmhandsco.com",
      address: null,
      city: "Sandpoint",
      categories: ["Retail"],
      hoursOfOperation: {
        sunday: "9:00am-5:00pm",
        monday: "9:00am-8:00pm",
        tuesday: "9:00am-8:00pm",
        wednesday: "9:00am-8:00pm",
        thursday: "9:00am-8:00pm",
        friday: "9:00am-8:00pm",
        saturday: "9:00am-5:00pm",
      },
      logoUrl:
        "https://static.wixstatic.com/media/2bdd49_5d32ece31c9f490aa2ff89bf4163f1ff~mv2.png/v1/fill/w_400,h_400,al_c,q_85,enc_avif,quality_auto/eeeee861d3be78f34739314f83d3a5f0_edited.png",
      photos: [
        "https://static.wixstatic.com/media/2bdd49_5d32ece31c9f490aa2ff89bf4163f1ff~mv2.png/v1/fill/w_960,h_1440,al_c,q_90,enc_avif,quality_auto/36caa8_cc6c3ab589734709b97588b3ae32e463~mv2.png",
      ],
    },
    {
      memberEmail: "sponsor2@nwc.local",
      slug: "stand-up-closets-garages",
      name: "Stand Up Closets & Garages",
      shortDescription:
        "Our mission at Stand Up Closets & Garages is to transform cluttered or inefficient spaces into organized, intuitive environments that support the way our customers live and work. We are dedicated to quality workmanship, honest service, and providing storage solutions that add long‑term value, durability, and comfort to every space we touch.",
      fullDescription:
        "As a family-owned and operated business, Stand Up Closets and Garages takes pride in helping our community create organized, functional, and beautiful spaces. We specialize in custom storage solutions for every area of your home, garage, or business—from closets and cabinets to fully custom built-ins. We provide the best selection of garage cabinets, workbenches, and tool chests, along with the most durable slatwall organizational system on the market. As your trusted local source for Swisstrax modular flooring, we offer premium options that add durability and style to any garage, gym, game room, or workspace. With craftsmanship, care, and personal service, we make organization look beautiful—and feel effortless.",
      website: "https://standupcda.com",
      phone: "208-704-0006",
      email: "Thomas@standupcda.com",
      address: null,
      city: "Post Falls",
      categories: ["Cabinets", "Home Service"],
      hoursOfOperation: {
        sunday: "CLOSED",
        monday: "8:00-5:00",
        tuesday: "8:00-5:00",
        wednesday: "8:00-5:00",
        thursday: "8:00-5:00",
        friday: "8:00-5:00",
        saturday: "10:00-3:00",
      },
      logoUrl:
        "https://static.wixstatic.com/media/2bdd49_305f077208eb46b4b6a809133e8e10aa~mv2.png/v1/fill/w_960,h_960,al_c,q_90,enc_avif,quality_auto/2bdd49_305f077208eb46b4b6a809133e8e10aa~mv2.png",
      photos: [
        "https://static.wixstatic.com/media/2bdd49_fa54731cec1540faad64b76b2bc3db17~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_fa54731cec1540faad64b76b2bc3db17~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_8f2fd981741047b0b74c56869c63c768~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_8f2fd981741047b0b74c56869c63c768~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_e660bf7dc11b4f24acf6ab8225229665~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_e660bf7dc11b4f24acf6ab8225229665~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_adc8f300b7d849d9954ea1c11e11e5c5~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_adc8f300b7d849d9954ea1c11e11e5c5~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_f53e2a1d31384f67b7f021d1aea61b30~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_f53e2a1d31384f67b7f021d1aea61b30~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_4481d57437784a0e9ff342749f0aa97b~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_4481d57437784a0e9ff342749f0aa97b~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_7a5be9f435884ebb9ed62f624698d37c~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_7a5be9f435884ebb9ed62f624698d37c~mv2.jpeg",
      ],
    },
    {
      memberEmail: "sponsor3@nwc.local",
      slug: "wild-child-socials",
      name: "Wild Child Socials",
      shortDescription:
        "Wild Child Socials was born from a deep knowing that marketing is meant to be relational, not transactional. I help small, purpose-driven businesses grow sustainably while staying true to who they are and why they started.",
      fullDescription:
        "Wild Child Socials was born from a deep knowing that marketing is meant to be relational, not transactional. Over the years, I watched businesses chase leads, numbers, and constant growth while quietly overlooking the very thing that sustains them long term: community. The people who show up, trust the work, and share it with others are the foundation, not an afterthought.\n\nBoth of my parents were chiropractors, so I was raised inside the holistic and wellness community. I grew up watching small, heart-led, mom and pop practices build their businesses through trust, education, and genuine care for the people they served. This world shaped how I understand business, healing, and connection, and it continues to guide how I approach marketing today.\n\nBecause I come from this space, I understand that holistic businesses operate differently than large companies. Their work is deeply personal and relational, and their marketing needs to reflect that. I am able to represent wellness and community-driven businesses in a way that feels aligned and authentic, rather than forcing them into systems designed for scale at all costs.\n\nI have been working in marketing since 2020, but Wild Child Socials came from a desire to do things differently. To create thoughtful, intuitive marketing rooted in integrity, consistency, and care. My approach blends strategy with soul, structure with intention, and growth with grounding.\n\nAs a sponsor, my intention is to support spaces that value connection, healing, and community. Wild Child Socials exists to help small, purpose-driven businesses grow sustainably while staying true to who they are and why they started.",
      website: "http://www.wildchildsocials.com",
      phone: "208.771.2019",
      email: "wildchildsocials@gmail.com",
      address: null,
      city: "Coeur d'Alene",
      categories: ["Marketing"],
      hoursOfOperation: {
        sunday: "CLOSED",
        monday: "9am-6pm",
        tuesday: "9am-6pm",
        wednesday: "9am-6pm",
        thursday: "9am-6pm",
        friday: "9am-6pm",
        saturday: "CLOSED",
      },
      logoUrl:
        "https://static.wixstatic.com/media/ae9ccb_43b5e05dee1a494a8ba452f578b18bbb~mv2.png/v1/fill/w_960,h_960,al_c,q_90,enc_avif,quality_auto/ae9ccb_43b5e05dee1a494a8ba452f578b18bbb~mv2.png",
      photos: [
        "https://static.wixstatic.com/media/ae9ccb_b829c738e8114a81a9cd9f63502d37bc~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/ae9ccb_b829c738e8114a81a9cd9f63502d37bc~mv2.jpeg",
      ],
    },
    {
      memberEmail: "sponsor3@nwc.local",
      slug: "boujielashes-tanning",
      name: "BoujieLashes Tanning",
      shortDescription:
        "Welcome to BoujieLashes Tanning — where luxury meets a little sass. We're your go-to beauty and glow destination, featuring all brand-new, state-of-the-art beds.",
      fullDescription:
        "Welcome to BoujieLashes Tanning — where luxury meets a little sass. ✨\nWe're your go-to beauty and glow destination, featuring all brand-new, state-of-the-art beds, including a 12-minute max high-intensity ProSun tanning bed, a 15-minute red light therapy bed, and a fusion combo bed that delivers the best of both worlds. Prefer a sunless glow? We offer Norvell airbrush spray tans by appointment for a flawless, natural-looking tan.\nBeyond tanning, BoujieLashes Tanning is your one-stop beauty spot. By appointment, we offer permanent jewelry, waxing, brow tinting, and lash lifts—perfect for maintaining that effortlessly put-together look.\nAnd because beauty should be fun, we also offer boutique-style shopping you'll love: brand-new-with-tags purses and wallets from Wrangler, Montana West, and Trinity Ranch, plus adorable keychains, super-soft blankets, and eye-catching metal wall signs.\nCome glow, get pampered, and treat yourself—because boujie looks good on you. 💖\nOpen 7 days a week! Single mama owned and run! No corporate hoops or extra fees!",
      website: "http://www.vagaro.com/boujielashestanning",
      phone: "208-669-1699",
      email: "Boujielashestanning@gmail.com",
      address: "13594 W Hwy 53, Rathdrum, ID 83858",
      city: "Rathdrum",
      categories: ["Tanning", "Spa"],
      hoursOfOperation: {
        sunday: "10:00-3:00",
        monday: "9:00-7:00",
        tuesday: "7:00-7:00",
        wednesday: "7:00-7:00",
        thursday: "9:00-7:00",
        friday: "9:00-7:00",
        saturday: "10:00-5:00",
      },
      logoUrl:
        "https://static.wixstatic.com/media/b63d9f_ba117a6be0864f40968d499bc3c5d405~mv2.jpeg/v1/fill/w_400,h_400,al_c,q_80,enc_avif,quality_auto/eeeee861d3be78f34739314f83d3a5f0_edited.jpeg",
      photos: [
        "https://static.wixstatic.com/media/b63d9f_b898840df22e4807855a56678b434ac4~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_b898840df22e4807855a56678b434ac4~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_b39bd95adcad4ec79b76a01d637eee9d~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_b39bd95adcad4ec79b76a01d637eee9d~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_c15ea44078664f46afd32f91aef77170~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_c15ea44078664f46afd32f91aef77170~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_18e061b860024ae78132d38d327055fd~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_18e061b860024ae78132d38d327055fd~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_760b7ab18e3c44019bd717fb7f774261~mv2.jpeg/v1/fit/w_960,h_964,q_90,enc_avif,quality_auto/b63d9f_760b7ab18e3c44019bd717fb7f774261~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_8b524b586db64dc696dbe68b77c692b3~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_8b524b586db64dc696dbe68b77c692b3~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_41f1d25e72334f31a93a50a9ad75a8f9~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_41f1d25e72334f31a93a50a9ad75a8f9~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_339543ce7fcf476c97acc931830b5752~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_339543ce7fcf476c97acc931830b5752~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_93676ee6e9a749538ca56f10cbb1b633~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_93676ee6e9a749538ca56f10cbb1b633~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_c0bfb2d265a14e5e936946763a85e91a~mv2.jpeg/v1/fit/w_960,h_964,q_90,enc_avif,quality_auto/b63d9f_c0bfb2d265a14e5e936946763a85e91a~mv2.jpeg",
        "https://static.wixstatic.com/media/b63d9f_c586402b949243edac4c761cf19007cb~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/b63d9f_c586402b949243edac4c761cf19007cb~mv2.jpeg",
      ],
    },
    {
      memberEmail: "sponsor4@nwc.local",
      slug: "djb-bookkeeping",
      name: "DJB Bookkeeping",
      shortDescription:
        "Self-starting, highly organized nerd who enjoys all aspects of bookkeeping. I started my own bookkeeping business in October of 2025 and look forward to helping small businesses grow!",
      fullDescription:
        "I love helping small businesses grow by optimizing their bookkeeping. That way they can concentrate on other aspects to help your business thrive. I focus on accounting services to support business owners as they concentrate on driving sales, establishing relationships, marketing, managing inventory, and daily operations. I offer remote and/or on site bookkeeping and payroll services. I'm also a notary public and offer mobile notary service.",
      website: "http://www.bookkeepingbydjb.com",
      phone: "208-512-1322",
      email: "djb.bookkeeping85@gmail.com",
      address: "10307 N Maple St, Hayden, ID 83835",
      city: "Hayden",
      categories: ["Bookkeeping"],
      hoursOfOperation: {
        sunday: "CLOSED",
        monday: "9:00am-5:00pm",
        tuesday: "9:00am-5:00pm",
        wednesday: "9:00am-5:00pm",
        thursday: "9:00am-5:00pm",
        friday: "9:00am-5:00pm",
        saturday: "CLOSED",
      },
      logoUrl:
        "https://static.wixstatic.com/media/0e3a5e_0c39fff2402d4ed2b5d0738484d227bb~mv2.png/v1/fill/w_400,h_400,al_c,q_85,enc_avif,quality_auto/DJB%20logo.png",
      photos: [
        "https://static.wixstatic.com/media/2bdd49_300b551484834010accf789aecf1490c~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_300b551484834010accf789aecf1490c~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_dc49a7566d40452191addcdab2abae4e~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_dc49a7566d40452191addcdab2abae4e~mv2.jpg",
      ],
    },
    {
      memberEmail: "sponsor4@nwc.local",
      slug: "cedar-stone-consulting",
      name: "Cedar & Stone Consulting",
      shortDescription:
        "Cedar & Stone Consulting was born from a simple but powerful belief: finance should feel personal. I offer guidance rooted in trust, connection, and real understanding.",
      fullDescription:
        "🌿 Who We Are\n\nCedar & Stone Consulting was born from the soil and soul of the Inland Northwest.\n\nWe come from a place where small farms built strong families, where summers were measured in growing seasons, and where community wasn't a marketing word—it was how we survived. Our days once began in the rows and ended at farm stands, in kitchens, or curled up with hand-labeled jars of food we'd grown ourselves.\n\nThat legacy is still alive in us—and in the people we serve.\n\n🌿 Our Mission\n\nTo bring financial clarity, sustainability, and relief to the heart of our local economies—our farms, our makers, our rural small businesses and food systems—so they can flourish in purpose and profit.\n\n🌿 Our Vision\n\nWe envision a resilient regional economy rooted in stewardship and sustainability—where small businesses are well-supported, family farms are financially secure, and community-focused entrepreneurs are equipped to grow legacies, not just ledgers.\n\n🌿 What We Do\n\nAt Cedar & Stone, we walk alongside the hardworking people who feed us, serve us, and build vibrant communities. We offer down-to-earth support—without judgment, jargon, or one-size-fits-all templates.\n\nWe help you make sense of your numbers, streamline your systems, and make confident decisions with clear eyes on the future.\n\nThat might look like…\n\n• Untangling years of chaotic bookkeeping and creating an elegant, simplified accounting system (we're an Ambrook Certified Advisor, after all).\n• Helping a small ranch track profitability across grazing rotations, market sales, and value-added products—so they can stop bleeding money and start building margin.\n• Working with a local business owner to set up a three-tier healthcare plan that actually works for their team—and their budget.\n• Helping a regenerative farm access grant funding, cut their card processing fees, and reinvest in better infrastructure without drowning in paperwork.\n• Sitting down—yes, literally or virtually—with someone who's exhausted and overwhelmed, and helping them breathe easier with a real financial roadmap.\n\nWhether it's reducing expenses, increasing brand reach, or building a nest egg for retirement, our work is all about helping good people thrive. We believe in profit with purpose, and growth with heart.\n\n📍 Based in Eastern Washington, proudly serving clients across the rural West and beyond.\n🌾 Deeply rooted in agriculture, community, and sustainable living.\n📊 Certified Ambrook Advisor, Schooley Mitchell expense audits, and retirement planning strategies.\n💚 Committed to kind, clear, and actionable guidance.",
      website: null,
      phone: "509-903-8813",
      email: "Cedarstoneconsult@gmail.com",
      address: null,
      city: "Spokane",
      categories: ["Finance", "Business Consulting"],
      hoursOfOperation: {
        sunday: "Closed",
        monday: "9:00-5:00",
        tuesday: "9:00-5:00",
        wednesday: "9:00-5:00",
        thursday: "9:00-5:00",
        friday: "9:00-5:00",
        saturday: "Closed",
      },
      logoUrl:
        "https://static.wixstatic.com/media/9cc30f_3bacfb80d5314693af72b033177a0c10~mv2.jpeg/v1/fill/w_400,h_400,al_c,q_80,enc_avif,quality_auto/eeeee861d3be78f34739314f83d3a5f0_edited.jpeg",
      photos: [
        "https://static.wixstatic.com/media/9cc30f_e288c950aa5a495bac523834269a41be~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/9cc30f_e288c950aa5a495bac523834269a41be~mv2.jpeg",
        "https://static.wixstatic.com/media/9cc30f_c10d1f93e27743c2af02ca0c54c8cb0e~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/9cc30f_c10d1f93e27743c2af02ca0c54c8cb0e~mv2.jpeg",
        "https://static.wixstatic.com/media/9cc30f_8cb0b52ee2824797882df543d215b589~mv2.jpeg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/9cc30f_8cb0b52ee2824797882df543d215b589~mv2.jpeg",
        "https://static.wixstatic.com/media/9cc30f_48e9ba600617426386cbac3f1bf8566c~mv2.jpeg/v1/fit/w_960,h_432,q_90,enc_avif,quality_auto/9cc30f_48e9ba600617426386cbac3f1bf8566c~mv2.jpeg",
      ],
    },
    {
      memberEmail: "sponsor5@nwc.local",
      slug: "covenant-homes-and-resources",
      name: "Covenant Homes and Resources",
      shortDescription: "Christian emergency housing for pregnant or single moms, especially considering abortion",
      fullDescription:
        "We walk alongside our moms in their life, where ever they are. We love on and encourage them while teaching them full life skills; cooking, cleaning, budgeting, communication, parenting and hobbies. We help them return to school or get a job. We require 1 bible study a week, and the other 167 hours we just love on them. We have been walking with moms since 2018. Would you like to join us in changing lives? It is SO fulfilling! We love our volunteers and partners! We love to show off the house so you can \"see the vision\"! We will post our events, but call or email anytime! It really does take a village!!",
      website: "http://www.covenanthomesandresources.org",
      phone: "509-418-2751",
      email: "covenanthomes@comcast.net",
      address: "2012 N Ruby St, Spokane, WA 99207",
      city: "Spokane",
      categories: ["Nonprofit"],
      hoursOfOperation: {
        sunday: "Closed",
        monday: "10am - 5pm",
        tuesday: "10am - 5pm",
        wednesday: "10am - 5pm",
        thursday: "10am - 5pm",
        friday: "10am - 5pm",
        saturday: "Closed",
      },
      logoUrl:
        "https://static.wixstatic.com/media/45ed52_b32ef5e7995c4205b4081e8ed40f1474~mv2.jpg/v1/fill/w_400,h_400,al_c,q_80,enc_avif,quality_auto/eeeee861d3be78f34739314f83d3a5f0_edited.jpg",
      photos: [
        "https://static.wixstatic.com/media/45ed52_b32ef5e7995c4205b4081e8ed40f1474~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,enc_avif,quality_auto/mom%20and%20baby.jpg",
        "https://static.wixstatic.com/media/2bdd49_094c34b4f636456bb6271368a64bd7c3~mv2.png/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_094c34b4f636456bb6271368a64bd7c3~mv2.png",
        "https://static.wixstatic.com/media/2bdd49_9689d31c17ba417d85b5e59636e0e34b~mv2.jpeg/v1/fit/w_681,h_649,q_90,enc_avif,quality_auto/2bdd49_9689d31c17ba417d85b5e59636e0e34b~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_e660b63bd41544be889c4c0f5b7c6e48~mv2.jpeg/v1/fit/w_665,h_665,q_90,enc_avif,quality_auto/2bdd49_e660b63bd41544be889c4c0f5b7c6e48~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_7da1f2b54933499fb1ac307ea4a0c205~mv2.jpeg/v1/fit/w_665,h_665,q_90,enc_avif,quality_auto/2bdd49_7da1f2b54933499fb1ac307ea4a0c205~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_f326f4c631554158a6fe45263163a8bc~mv2.jpeg/v1/fit/w_663,h_665,q_90,enc_avif,quality_auto/2bdd49_f326f4c631554158a6fe45263163a8bc~mv2.jpeg",
        "https://static.wixstatic.com/media/2bdd49_35150f9a3c674af6842d2a5903ab6d3e~mv2.jpeg/v1/fit/w_681,h_649,q_90,enc_avif,quality_auto/2bdd49_35150f9a3c674af6842d2a5903ab6d3e~mv2.jpeg",
      ],
    },
    {
      memberEmail: "sponsor5@nwc.local",
      slug: "helmszz-deep-ink",
      name: "Helmszz Deep Ink",
      shortDescription:
        "Helmszz Deep Ink is a local tattoo shop that takes pride in clean and unique work. The artists at Helmszz Deep strive to bring their clients vision to life with tattoos that stand out from the crowd.",
      fullDescription:
        "Helmszz Deep Ink is a tattoo and piercing shop in Hayden, Idaho, known for its welcoming atmosphere, clean environment, and artists who specialize in various styles like fine-line, Japanese-traditional, and realism.\nThey accept both walk-ins and appointments, offering custom tattoo designs and professional aftercare options, and are praised for their friendly and professional staff.\n\nIndividual Artists:\nCourtney Helms\ninsta: @helmszz\nRylan Floyd\ninsta: @tattoosbyboness\nJake Casey\ninsta: @southpaw.jake",
      website: "https://www.helmszzdeep-ink.com",
      phone: "(208) 304-5960",
      email: "Helmszzdeep@gmail.com",
      address: "9045 Hess St, Hayden, ID 83835",
      city: "Hayden",
      categories: ["Tattoos"],
      hoursOfOperation: {
        sunday: "Closed",
        monday: "Closed",
        tuesday: "12:00 - 6:00",
        wednesday: "12:00 - 6:00",
        thursday: "12:00 - 6:00",
        friday: "12:00 - 6:00",
        saturday: "12:00 - 6:00",
      },
      logoUrl:
        "https://static.wixstatic.com/media/2bdd49_875ca59c8cbb48189496fce34bb9e2e9~mv2.jpeg/v1/fill/w_400,h_400,al_c,q_80,enc_avif,quality_auto/eeeee861d3be78f34739314f83d3a5f0_edited.jpeg",
      photos: [
        "https://static.wixstatic.com/media/2bdd49_9a65d46a1c7249899766f4c32ad6fd56~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_9a65d46a1c7249899766f4c32ad6fd56~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_ef763166f432421591bc9028d3216b11~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_ef763166f432421591bc9028d3216b11~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_1a9f0b8fe4ae4bb198d80d006ca75780~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_1a9f0b8fe4ae4bb198d80d006ca75780~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_7be42de477f642d1be637dfab90ce819~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_7be42de477f642d1be637dfab90ce819~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_6da5695ee4af43e0afea78be306797dc~mv2.jpg/v1/fit/w_960,h_964,q_90,enc_avif,quality_auto/2bdd49_6da5695ee4af43e0afea78be306797dc~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_9a041d2d3e4d47f2a8d65a8995e88434~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_9a041d2d3e4d47f2a8d65a8995e88434~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_503b70bb220b46259993ec20ab0c7229~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_503b70bb220b46259993ec20ab0c7229~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_f895500ac87f47988547c9c68426213c~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_f895500ac87f47988547c9c68426213c~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_a79f4d9f22144d14bb25fb055fa4f04d~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_a79f4d9f22144d14bb25fb055fa4f04d~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_efb42235df1b4bc9bbb6755208597edb~mv2.jpg/v1/fit/w_960,h_964,q_90,enc_avif,quality_auto/2bdd49_efb42235df1b4bc9bbb6755208597edb~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_09bf65f9bd7d4311b35decfb041d5f88~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_09bf65f9bd7d4311b35decfb041d5f88~mv2.jpg",
        "https://static.wixstatic.com/media/2bdd49_449ee1e91656440f8611f4e20f89f559~mv2.jpg/v1/fit/w_960,h_960,q_90,enc_avif,quality_auto/2bdd49_449ee1e91656440f8611f4e20f89f559~mv2.jpg",
      ],
    },
    {
      memberEmail: "sponsor6@nwc.local",
      slug: "coach-boe",
      name: "Coach Boe",
      shortDescription:
        "I'm a resiliency coach focused on helping people strengthen their ability to withstand stress, adapt under pressure, and recover quickly from setbacks—mentally, emotionally, spiritually, and physically.",
      fullDescription:
        "Resiliency is not about motivation, positive thinking, or pushing harder, it's about developing the internal capacity to withstand pressure, adapt to change, and move forward with clarity and strength. My work as a resiliency coach is centered on helping individuals build that capacity so life's challenges no longer dictate their direction.\n\nMy mission is to help people strengthen their internal foundation mentally, emotionally, spiritually, and physically so they can respond intentionally rather than react under stress. In a world that rewards performance but ignores internal stability, I focus on building the resilience required for sustainable growth, leadership, and fulfillment.\n\nMy approach is shaped by both professional training and lived experience. I understand firsthand what it means to operate without resilience—and what it takes to rebuild it. That perspective informs a coaching style that is grounded, practical, and results-driven. I don't offer surface-level strategies or temporary motivation. I help clients identify the internal patterns, beliefs, and stress responses that quietly erode clarity and momentum, then guide them through rebuilding from the inside out.\n\nThrough one-on-one coaching, group programs, workshops, and speaking engagements, I work with individuals and organizations to develop real-world resilience skills. This includes strengthening self-regulation under pressure, improving decision-making during stress, restoring energy and focus, and building the ability to recover quickly from setbacks. The goal is not to eliminate challenges, but to ensure challenges no longer derail progress.\n\nI work with professionals, leaders, entrepreneurs, and individuals who want more than coping mechanisms. They want stability. They want clarity. They want the confidence that comes from knowing they can handle what's in front of them, without burning out or losing themselves in the process.\n\nAt its core, my work is about resilience that lasts. Not reactive strength, but steady capacity. Not survival mode, but grounded forward movement. Because when resilience is built properly, everything else becomes more sustainable.",
      website: "https://www.chrisboecoaching.com",
      phone: "(208) 371-2909",
      email: "chris@coachboe.com",
      address: null,
      city: "Coeur d'Alene",
      categories: ["Coaching"],
      hoursOfOperation: {
        sunday: "CLOSED",
        monday: "OPEN",
        tuesday: "OPEN",
        wednesday: "OPEN",
        thursday: "OPEN",
        friday: "OPEN",
        saturday: "CLOSED",
      },
      logoUrl:
        "https://static.wixstatic.com/media/2bdd49_20681789e7104d3a8d9c795819394858~mv2.jpg/v1/fill/w_400,h_400,al_c,q_80,enc_avif,quality_auto/eeeee861d3be78f34739314f83d3a5f0_edited.jpg",
      photos: [
        "https://static.wixstatic.com/media/2bdd49_c75bbf0e6167492382226ba9249377b9~mv2.jpeg/v1/fit/w_860,h_860,q_90,enc_avif,quality_auto/2bdd49_c75bbf0e6167492382226ba9249377b9~mv2.jpeg",
      ],
    },
  ];

  const toDelete = await prisma.business.findFirst({
    where: {
      OR: [
        { slug: "donivan-vintage" },
        { slug: "donivanvintage" },
        { name: { contains: "Donivan Vintage", mode: "insensitive" } },
      ],
    },
  });
  if (toDelete) {
    await prisma.business.delete({ where: { id: toDelete.id } });
    console.log("Deleted business:", toDelete.name);
  }

  // Normalize city names to fix duplicates (e.g. "Coeur D'Alene" vs "Coeur d'Alene")
  const { count: cdaCount } = await prisma.business.updateMany({
    where: { city: { equals: "Coeur d'Alene", mode: "insensitive" } },
    data: { city: "Coeur d'Alene" },
  });
  // Also catch case variants: find any that lowercase to coeur d'alene and fix
  const toNormalize = await prisma.business.findMany({
    where: { city: { not: null } },
    select: { id: true, city: true },
  });
  const canonical = "Coeur d'Alene";
  const normalized = toNormalize.filter((b) => b.city && b.city.toLowerCase().replace(/[''`]/g, "'") === "coeur d'alene" && b.city !== canonical);
  for (const b of normalized) {
    await prisma.business.update({ where: { id: b.id }, data: { city: canonical } });
  }
  if (cdaCount > 0 || normalized.length > 0) {
    console.log("Normalized Coeur d'Alene for", cdaCount + normalized.length, "business(es)");
  }

  for (const biz of SPONSOR_BUSINESSES) {
    const existing = await prisma.business.findFirst({ where: { slug: biz.slug } });
    const bizMember = sponsorByEmail[biz.memberEmail];
    if (!bizMember) {
      console.warn("Skipping", biz.name, "– sponsor not found:", biz.memberEmail);
      continue;
    }
    const bizData = {
      memberId: bizMember.id,
      name: biz.name,
      shortDescription: biz.shortDescription,
      fullDescription: biz.fullDescription,
      website: biz.website ?? null,
      phone: biz.phone ?? null,
      email: biz.email ?? null,
      logoUrl: biz.logoUrl ?? null,
      address: biz.address ?? null,
      city: biz.city ?? null,
      categories: biz.categories,
      slug: biz.slug,
      photos: biz.photos ?? [],
      hoursOfOperation: biz.hoursOfOperation ?? undefined,
    };
    if (existing) {
      await prisma.business.update({
        where: { id: existing.id },
        data: bizData,
      });
      console.log("Updated business:", biz.name);
    } else {
      await prisma.business.create({ data: bizData });
      console.log("Created business:", biz.name);
    }
  }

  // Blog categories
  const defaultCategories = [
    { name: "Local News", slug: "local-news" },
    { name: "Events", slug: "events" },
    { name: "Fitness & Health", slug: "fitness-health" },
    { name: "Food & Dining", slug: "food-dining" },
    { name: "Business", slug: "business" },
    { name: "Community", slug: "community" },
    { name: "Other", slug: "other" },
  ];
  for (const cat of defaultCategories) {
    await prisma.blogCategory.upsert({
      where: { slug: cat.slug },
      create: cat,
      update: {},
    });
  }
  console.log("Ensured blog categories exist");

  const defaultTags = [
    { name: "Local", slug: "local" },
    { name: "Events", slug: "events" },
    { name: "Food", slug: "food" },
    { name: "Fitness", slug: "fitness" },
    { name: "Business", slug: "business" },
    { name: "Community", slug: "community" },
    { name: "Arts", slug: "arts" },
    { name: "Sports", slug: "sports" },
    { name: "Family", slug: "family" },
    { name: "Deals", slug: "deals" },
  ];
  for (const tag of defaultTags) {
    await prisma.tag.upsert({
      where: { slug: tag.slug },
      create: tag,
      update: {},
    });
  }
  console.log("Ensured default tags exist");

  // Trial coupon for coupon book / popup testing (same sponsor business)
  const businessForCoupon = await prisma.business.findFirst({
    where: { slug: "djs-coins-collectibles" },
  });
  if (businessForCoupon) {
    const existingTrialCoupon = await prisma.coupon.findFirst({
      where: { businessId: businessForCoupon.id, name: "Trial Coupon – 10% Off" },
    });
    if (!existingTrialCoupon) {
      await prisma.coupon.create({
        data: {
          businessId: businessForCoupon.id,
          name: "Trial Coupon – 10% Off",
          discount: "10% off your first month of service (excludes notary services)",
          code: "10DJB",
          imageUrl: null,
        },
      });
      console.log("Created trial coupon: Trial Coupon – 10% Off (code: 10DJB)");
    }
  }

  // Test seller account for storefront
  const sellerEmail = "seller@nwc.local";
  let seller = await prisma.member.findUnique({ where: { email: sellerEmail } });
  if (!seller) {
    const sellerHash = await bcrypt.hash("Seller123!", 10);
    seller = await prisma.member.create({
      data: {
        email: sellerEmail,
        passwordHash: sellerHash,
        firstName: "Test",
        lastName: "Seller",
        city: "Spokane",
      },
    });
    console.log("Created seller login:", seller.email, "(password: Seller123!)");
  }
  let sellerSub = await prisma.subscription.findFirst({
    where: { memberId: seller.id, plan: "seller" },
  });
  if (!sellerSub) {
    await prisma.subscription.create({
      data: {
        memberId: seller.id,
        plan: "seller",
        status: "active",
      },
    });
    console.log("Created seller subscription for test seller");
  }

  // Universal test account – has subscribe, sponsor, and seller for testing all features
  const universalEmail = "universal@nwc.local";
  let universal = await prisma.member.findUnique({ where: { email: universalEmail } });
  if (!universal) {
    const universalHash = await bcrypt.hash("Universal123!", 10);
    universal = await prisma.member.create({
      data: {
        email: universalEmail,
        passwordHash: universalHash,
        firstName: "Universal",
        lastName: "Tester",
        city: "Spokane",
      },
    });
    console.log("Created universal test login:", universal.email, "(password: Universal123!)");
  }
  for (const plan of ["subscribe", "sponsor", "seller"]) {
    const existing = await prisma.subscription.findFirst({
      where: { memberId: universal.id, plan },
    });
    if (!existing) {
      await prisma.subscription.create({
        data: {
          memberId: universal.id,
          plan,
          status: "active",
        },
      });
      console.log("Added", plan, "subscription to universal test account");
    }
  }

  // Trial order for universal account (shipping test)
  const existingTrialOrder = await prisma.storeOrder.findFirst({
    where: { sellerId: universal.id, buyerId: universal.id, status: "paid" },
  });
  if (!existingTrialOrder) {
    const slug = `trial-shipping-${Date.now()}`;
    const trialItem = await prisma.storeItem.create({
      data: {
        memberId: universal.id,
        title: "Trial item (shipping test)",
        description: "Sample order for testing shipping labels and rates. You can delete this item from your store.",
        photos: ["https://static.wixstatic.com/media/2bdd49_46bd85d79e654db9bfc8b6d2a206d9a2~mv2.jpg/v1/fill/w_200,h_200,al_c,q_80,enc_avif,quality_auto/0005_3A.jpg"],
        category: "Test",
        priceCents: 999,
        quantity: 1,
        status: "active",
        shippingCostCents: 500,
        shippingPolicy: "Standard shipping. Trial item for testing.",
        slug,
      },
    });
    await prisma.storeOrder.create({
      data: {
        buyerId: universal.id,
        sellerId: universal.id,
        subtotalCents: 999,
        shippingCostCents: 500,
        totalCents: 1499,
        status: "paid",
        shippingAddress: { street: "123 Test Street", city: "Spokane", state: "WA", zip: "99201" },
        items: {
          create: { storeItemId: trialItem.id, quantity: 1, priceCentsAtPurchase: 999 },
        },
      },
    });
    console.log("Created trial order for universal@nwc.local (for shipping test)");
  }

  // Test subscriber account (Community Resale hub, no Seller plan)
  const subscriberEmail = "subscriber@nwc.local";
  let subscriber = await prisma.member.findUnique({ where: { email: subscriberEmail } });
  if (!subscriber) {
    const subscriberHash = await bcrypt.hash("Subscriber123!", 10);
    subscriber = await prisma.member.create({
      data: {
        email: subscriberEmail,
        passwordHash: subscriberHash,
        firstName: "Test",
        lastName: "Subscriber",
        city: "Spokane",
      },
    });
    console.log("Created subscriber login:", subscriber.email, "(password: Subscriber123!)");
  }
  let subscribeSub = await prisma.subscription.findFirst({
    where: { memberId: subscriber.id, plan: "subscribe" },
  });
  if (!subscribeSub) {
    await prisma.subscription.create({
      data: {
        memberId: subscriber.id,
        plan: "subscribe",
        status: "active",
      },
    });
    console.log("Created subscribe subscription for test subscriber");
  }

  // Test Friend – auto-responds with :) when you message them
  const testFriendEmail = "testfriend@nwc.local";
  let testFriend = await prisma.member.findUnique({ where: { email: testFriendEmail } });
  if (!testFriend) {
    const testFriendHash = await bcrypt.hash("TestFriend123!", 10);
    testFriend = await prisma.member.create({
      data: {
        email: testFriendEmail,
        passwordHash: testFriendHash,
        firstName: "Test",
        lastName: "Friend",
        city: "Spokane",
      },
    });
    console.log("Created test friend:", testFriend.email, "(password: TestFriend123!)");
  }
  let testFriendSub = await prisma.subscription.findFirst({
    where: { memberId: testFriend.id, plan: "subscribe" },
  });
  if (!testFriendSub) {
    await prisma.subscription.create({
      data: {
        memberId: testFriend.id,
        plan: "subscribe",
        status: "active",
      },
    });
    console.log("Created subscribe subscription for test friend");
  }
  // Make test friend appear in friends list for universal and subscriber
  for (const account of [universal, subscriber]) {
    const [reqId, addrId] = account.id < testFriend.id ? [account.id, testFriend.id] : [testFriend.id, account.id];
    const existingFr = await prisma.friendRequest.findUnique({
      where: { requesterId_addresseeId: { requesterId: reqId, addresseeId: addrId } },
    });
    if (!existingFr) {
      await prisma.friendRequest.create({
        data: { requesterId: reqId, addresseeId: addrId, status: "accepted" },
      });
      console.log("Added Test Friend as friend of", account.firstName, account.lastName);
    }
  }

  // Test resale item (owned by subscriber so you can test as buyer when logged in as someone else)
  const testResaleSlug = "test-resale-item";
  let testResaleItem = await prisma.storeItem.findUnique({
    where: { slug: testResaleSlug },
  });
  if (!testResaleItem) {
    testResaleItem = await prisma.storeItem.create({
      data: {
        memberId: subscriber.id,
        businessId: null,
        title: "Test Resale Item – Used Book",
        description: "A test listing for Community Resale. Use this to try Make Offer, Send Message to Seller, and checkout (Pay by Card / Pay in Cash).",
        photos: [],
        category: "Books",
        priceCents: 999,
        variants: null,
        quantity: 1,
        status: "active",
        shippingCostCents: 299,
        shippingPolicy: "Ships via USPS. Allow 3–5 business days.",
        localDeliveryAvailable: true,
        localDeliveryFeeCents: 0,
        inStorePickupAvailable: true,
        shippingDisabled: false,
        localDeliveryTerms: "Local delivery within 20 miles. Contact to arrange.",
        slug: testResaleSlug,
        listingType: "resale",
        acceptOffers: true,
        minOfferCents: 500,
      },
    });
    console.log("Created test resale item:", testResaleItem.title, "→ /resale/" + testResaleSlug);
  } else {
    console.log("Test resale item already exists → /resale/" + testResaleSlug);
  }

  // Badges
  const BADGES = [
    { slug: "community_member", name: "Community Member", description: "Earned when you sign up as a resident.", category: "member", order: 0 },
    { slug: "local_business", name: "Local Business Badge", description: "Earned when your business joins Northwest Community.", category: "business", order: 1 },
    { slug: "nwc_seller", name: "NWC Seller Badge", description: "Earned when you list your first item.", category: "seller", order: 2 },
    { slug: "og_community_member", name: "OG Community Member", description: "Awarded to the first 1000 residents to sign up.", category: "member", order: 3 },
    { slug: "og_nwc_business", name: "OG NWC Business", description: "Awarded to the first 100 businesses to join Northwest Community.", category: "business", order: 4 },
    { slug: "community_star_business", name: "Community Star Business", description: "Businesses who offer $1000 of Rewards within 6 months. Featured on homepage.", category: "business", order: 5 },
    { slug: "bronze_seller", name: "Bronze Seller Badge", description: "Successfully delivered 10 orders.", category: "seller", order: 6 },
    { slug: "silver_seller", name: "Silver Seller Badge", description: "Successfully delivered 100 orders.", category: "seller", order: 7 },
    { slug: "gold_seller", name: "Gold Seller Badge", description: "Successfully delivered 500 orders.", category: "seller", order: 8 },
    { slug: "platinum_seller", name: "Platinum Seller Badge", description: "Successfully delivered 1000 orders.", category: "seller", order: 9 },
    { slug: "spreading_the_word", name: "Spreading the Word", description: "Share the app with 5 people who sign up. +20 Community Points.", category: "member", order: 10 },
    { slug: "community_writer", name: "Community Writer", description: "Share a blog post.", category: "member", order: 11 },
    { slug: "admin_badge", name: "Admin Badge", description: "Create a group.", category: "member", order: 12 },
    { slug: "local_business_pro", name: "Local Business Pro", description: "Spend $1000 in stores (total over time). +50 Community Points.", category: "member", order: 13 },
    { slug: "community_planner", name: "Community Planner Badge", description: "Post 5 events.", category: "member", order: 14 },
    { slug: "party_planner", name: "Party Planner", description: "Earned when you share 10 events with friends.", category: "member", order: 15 },
    { slug: "super_scanner", name: "Super Scanner", description: "Scan 10 QR codes (1 per business per day). +extra Community Points.", category: "member", order: 16 },
    { slug: "elite_scanner", name: "Elite Scanner", description: "Scan 50 QR codes (1 per business per day). +100 Community Points.", category: "member", order: 17 },
    { slug: "badger_badge", name: "The Badger Badge", description: "Earn 10 badges.", category: "member", order: 18 },
  ];
  for (const b of BADGES) {
    await prisma.badge.upsert({
      where: { slug: b.slug },
      create: b,
      update: { name: b.name, description: b.description, category: b.category, order: b.order },
    });
  }
  console.log("Ensured badges exist");

  // Test messaging: message, invite, and business share
  const [memberA, memberB] = universal.id < subscriber.id ? [universal.id, subscriber.id] : [subscriber.id, universal.id];

  let conv = await prisma.directConversation.findUnique({
    where: { memberAId_memberBId: { memberAId: memberA, memberBId: memberB } },
  });
  if (!conv) {
    conv = await prisma.directConversation.create({
      data: { memberAId: memberA, memberBId: memberB },
    });
    console.log("Created test direct conversation between Universal Tester and Test Subscriber");
  }

  // 1. Test plain message
  const existingMsg = await prisma.directMessage.findFirst({
    where: { conversationId: conv.id, content: "Hey! This is a test message from the seed." },
  });
  if (!existingMsg) {
    await prisma.directMessage.create({
      data: {
        conversationId: conv.id,
        senderId: universal.id,
        content: "Hey! This is a test message from the seed.",
      },
    });
    console.log("Added test message to conversation");
  }

  // 2. Test business share
  const businessForShare = await prisma.business.findFirst({ where: { slug: "djs-coins-collectibles" } });
  if (businessForShare) {
    const existingShare = await prisma.directMessage.findFirst({
      where: {
        conversationId: conv.id,
        sharedContentType: "business",
        sharedContentId: businessForShare.id,
      },
    });
    if (!existingShare) {
      await prisma.directMessage.create({
        data: {
          conversationId: conv.id,
          senderId: universal.id,
          content: "Check out this local business!",
          sharedContentType: "business",
          sharedContentId: businessForShare.id,
          sharedContentSlug: businessForShare.slug,
        },
      });
      console.log("Added test business share to conversation");
    }
  }

  // 3. Test event invite
  let testEvent = await prisma.event.findFirst({ where: { slug: "test-community-meetup" } });
  if (!testEvent) {
    testEvent = await prisma.event.create({
      data: {
        memberId: member.id,
        calendarType: "fun_events",
        title: "Test Community Meetup",
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        time: "6:00 PM",
        location: "Downtown Spokane",
        city: "Spokane",
        description: "A test event for invite testing.",
        slug: "test-community-meetup",
        photos: [],
      },
    });
    console.log("Created test event: Test Community Meetup");
  }
  const existingInvite = await prisma.eventInvite.findUnique({
    where: { eventId_inviteeId: { eventId: testEvent.id, inviteeId: subscriber.id } },
  });
  if (!existingInvite) {
    await prisma.eventInvite.create({
      data: {
        eventId: testEvent.id,
        inviterId: universal.id,
        inviteeId: subscriber.id,
        status: "pending",
      },
    });
    console.log("Created test event invite (Universal → Subscriber)");
  }

  await prisma.directConversation.update({
    where: { id: conv.id },
    data: { updatedAt: new Date() },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
