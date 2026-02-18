import { prisma } from "database";
import type { PageStructure } from "types";
import { WIX_IMG } from "@/lib/wix-media";

function genId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function genSectionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function genColId(): string {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Seed content for each editable page so the editor has content to load and edit. */
export async function seedSiteContent(): Promise<{ pageId: string; sections: number }[]> {
  const results: { pageId: string; sections: number }[] = [];

  const home: PageStructure = {
    sections: [
      {
        id: genSectionId(),
        columns: [
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "heading",
                content: { html: "<h1>Northwest Community</h1>", level: "1" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>Connecting the good people of Spokane & Kootenai County through our community feed and messaging, selling local goods, event calendars, NWC Requests, local coupons, and of course, fun events that bring the community together and support the beautiful Northwest we live in.</p>",
                },
              },
              { id: genId(), type: "button", content: { text: "Join Now", href: "/signup" } },
            ],
          },
        ],
        layout: "single",
      },
      {
        id: genSectionId(),
        columns: [
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "heading",
                content: { html: "<h2>Northwest Community Goals</h2>", level: "2" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>Insuring that locally owned business in this area continue to thrive. Northwest Community's goal is to continue connecting local clientele to the businesses that care.</p>",
                },
              },
              { id: genId(), type: "button", content: { text: "About NWC", href: "/about" } },
            ],
          },
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "image",
                content: {
                  src: WIX_IMG(
                    "2bdd49_9e1e39816a194b7d9e3557eb8a025cad~mv2.jpg/v1/fill/w_467,h_482,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Photo%20Nov%2007%202025%2C%209%2033%2002%20PM.jpg"
                  ),
                  alt: "Northwest Community",
                },
              },
            ],
          },
        ],
        layout: "two-col",
      },
    ],
  };

  const about: PageStructure = {
    sections: [
      {
        id: genSectionId(),
        columns: [
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "heading",
                content: { html: "<h1>Welcome to Northwest Community!</h1>", level: "1" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>Northwest Community is a community page dedicated to businesses and people of Eastern Washington and Northern Idaho. We hope this can be a resource for you to connect with many local resources.</p>",
                },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>Northwest Community is a locally operated company whose main objective is to incentivize people to support locally owned businesses and workers in the Spokane / Coeur d'Alene area.</p>",
                },
              },
              {
                id: genId(),
                type: "button",
                content: { text: "Northwest Community Sponsors", href: "/support-local" },
              },
              {
                id: genId(),
                type: "button",
                content: { text: "NWC Sponsorship Benefits", href: "/support-nwc" },
              },
            ],
          },
        ],
        layout: "single",
      },
      {
        id: genSectionId(),
        columns: [
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "heading",
                content: { html: "<h2>Northwest Community Goals</h2>", level: "2" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>As a startup, we do not currently have all the resources we need to do what we want. We would love to share our goals for the future!</p>",
                },
              },
              {
                id: genId(),
                type: "heading",
                content: { html: "<h3>Goal 1: Create a community page</h3>", level: "3" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>The goal of this website is to create a hub where local people can connect over hobbies, business, events, and more.</p>",
                },
              },
            ],
          },
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "image",
                content: {
                  src: WIX_IMG(
                    "2bdd49_922cf38aad0542ef88e46e2aac2b0497~mv2.jpg/v1/fill/w_600,h_400,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_922cf38aad0542ef88e46e2aac2b0497~mv2.jpg"
                  ),
                  alt: "",
                },
              },
            ],
          },
        ],
        layout: "two-col",
      },
    ],
  };

  const sponsorHub: PageStructure = {
    sections: [
      {
        id: genSectionId(),
        columns: [
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "image",
                content: {
                  src: WIX_IMG(
                    "2bdd49_df19a62a768348509f8d89fc76c9576d~mv2.jpg/v1/fill/w_147,h_57,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/2bdd49_df19a62a768348509f8d89fc76c9576d~mv2.jpg"
                  ),
                  alt: "Sponsor Hub",
                },
              },
              {
                id: genId(),
                type: "heading",
                content: { html: "<h1>Sponsor Hub</h1>", level: "1" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>Manage your business listing, coupons, events, and rewards. Sponsor Hub is available to members on the Sponsor or Seller plan.</p>",
                },
              },
            ],
          },
        ],
        layout: "single",
      },
    ],
  };

  const myCommunity: PageStructure = {
    sections: [
      {
        id: genSectionId(),
        columns: [
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "heading",
                content: { html: "<h1>My Northwest Community Profile</h1>", level: "1" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>Manage your profile, points, rewards, and community activity. This page shows your personalized content when logged in.</p>",
                },
              },
            ],
          },
        ],
        layout: "single",
      },
    ],
  };

  const calendars: PageStructure = {
    sections: [
      {
        id: genSectionId(),
        columns: [
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "heading",
                content: { html: "<h1>Northwest Community Calendars</h1>", level: "1" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>Local events not run by NWC. See what's happening in our area!</p>",
                },
              },
              {
                id: genId(),
                type: "button",
                content: { text: "Post Event", href: "/my-community/post-event" },
              },
            ],
          },
        ],
        layout: "single",
      },
    ],
  };

  const subscribe: PageStructure = {
    sections: [
      {
        id: genSectionId(),
        columns: [
          {
            id: genColId(),
            blocks: [
              {
                id: genId(),
                type: "image",
                content: {
                  src: WIX_IMG(
                    "2bdd49_df19a62a768348509f8d89fc76c9576d~mv2.jpg/v1/fill/w_147,h_57,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/2bdd49_df19a62a768348509f8d89fc76c9576d~mv2.jpg"
                  ),
                  alt: "Support Northwest Community",
                },
              },
              {
                id: genId(),
                type: "heading",
                content: { html: "<h1>Support Northwest Community</h1>", level: "1" },
              },
              {
                id: genId(),
                type: "paragraph",
                content: {
                  html: "<p>Signing up for a subscription helps support our business. It helps us put on big events in the community, create raffles, and offer other incentives for supporting local businesses!</p>",
                },
              },
              {
                id: genId(),
                type: "button",
                content: { text: "Become a Sponsor", href: "#plan-sponsor" },
              },
            ],
          },
        ],
        layout: "single",
      },
    ],
  };

  const seeds: { pageId: string; structure: PageStructure }[] = [
    { pageId: "home", structure: home },
    { pageId: "about", structure: about },
    { pageId: "sponsor-hub", structure: sponsorHub },
    { pageId: "my-community", structure: myCommunity },
    { pageId: "calendars", structure: calendars },
    { pageId: "subscribe", structure: subscribe },
  ];

  for (const { pageId, structure } of seeds) {
    const existing = await prisma.siteContent.findUnique({ where: { pageId } });
    const existingStructure = existing?.structure as PageStructure | null | undefined;
    if (existingStructure?.sections && Array.isArray(existingStructure.sections) && existingStructure.sections.length > 0) {
      continue; // Skip - page already has content
    }
    const structureJson = JSON.parse(JSON.stringify(structure));
    await prisma.siteContent.upsert({
      where: { pageId },
      create: { pageId, structure: structureJson },
      update: { structure: structureJson },
    });
    results.push({ pageId, sections: structure.sections.length });
  }

  return results;
}
