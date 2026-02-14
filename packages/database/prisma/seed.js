const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const exampleEmail = "sponsor@nwc.local";
  let member = await prisma.member.findUnique({ where: { email: exampleEmail } });

  if (!member) {
    const passwordHash = await bcrypt.hash("Sponsor123!", 10);
    member = await prisma.member.create({
      data: {
        email: exampleEmail,
        passwordHash,
        firstName: "Example",
        lastName: "Business",
        city: "Coeur d'Alene",
      },
    });
    console.log("Created sponsor login:", member.email, "(password: Sponsor123!)");
  }

  let sub = await prisma.subscription.findFirst({
    where: { memberId: member.id, plan: "sponsor" },
  });
  if (!sub) {
    sub = await prisma.subscription.create({
      data: {
        memberId: member.id,
        plan: "sponsor",
        status: "active",
      },
    });
    console.log("Created sponsor subscription for example member");
  }

  const existingBusiness = await prisma.business.findFirst({
    where: { slug: "djs-coins-collectibles" },
  });

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

  if (!existingBusiness) {
    await prisma.business.create({
      data: {
        memberId: member.id,
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
        hoursOfOperation: {
          monday: "9:00 AM - 5:00 PM",
          tuesday: "9:00 AM - 5:00 PM",
          wednesday: "9:00 AM - 5:00 PM",
          thursday: "9:00 AM - 5:00 PM",
          friday: "9:00 AM - 5:00 PM",
          saturday: "10:00 AM - 2:00 PM",
          sunday: "CLOSED",
        },
        categories: ["Retail"],
        logoUrl: "https://static.wixstatic.com/media/2bdd49_3e0b3310619741aebc191b1d45746584~mv2.jpeg/v1/fill/w_147,h_97,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/2bdd49_3e0b3310619741aebc191b1d45746584~mv2.jpeg",
        slug: "djs-coins-collectibles",
        photos: [
          "https://static.wixstatic.com/media/2bdd49_3e0b3310619741aebc191b1d45746584~mv2.jpeg/v1/fill/w_400,h_300,al_c,q_80,enc_avif,quality_auto/2bdd49_3e0b3310619741aebc191b1d45746584~mv2.jpeg",
          "https://static.wixstatic.com/media/2bdd49_5973186ad1e74d0ca02c0fab6af5c0be~mv2.png/v1/fill/w_400,h_300,al_c,q_80,enc_avif,quality_auto/2bdd49_5973186ad1e74d0ca02c0fab6af5c0be~mv2.png",
        ],
      },
    });
    console.log("Created example business: DJs Coins & Collectibles");
  } else {
    console.log("Example business already exists");
  }

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
