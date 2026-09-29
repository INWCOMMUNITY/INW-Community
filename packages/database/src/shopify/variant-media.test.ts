import { describe, expect, it, vi } from "vitest";
import {
  applyShopifyVariantMediaInbound,
  classifyVariantMediaInbound,
  planVariantMediaAssociations,
  planVariantMediaInboundAssociations,
  seedShopifyVariantMediaConvergence,
  variantMediaLocalFingerprint,
  variantMediaRemoteFingerprint,
} from "./variant-media";
import { shopifyMediaIdentityFingerprint } from "./media-map";

describe("planVariantMediaAssociations", () => {
  it("associates variant photos through durable maps without inventing identity", () => {
    const plan = planVariantMediaAssociations({
      variants: [
        { storeVariantId: "v-small", photos: ["https://cdn.example/small.jpg"] },
        { storeVariantId: "v-large", photos: ["https://cdn.example/large.jpg"] },
      ],
      mediaMaps: [
        {
          inwMediaId: "m1",
          sourceUrl: "https://cdn.example/small.jpg",
          shopifyMediaId: "gid://shopify/MediaImage/1",
          status: "ACTIVE",
        },
        {
          inwMediaId: "m2",
          sourceUrl: "https://cdn.example/large.jpg",
          shopifyMediaId: "gid://shopify/MediaImage/2",
          status: "ACTIVE",
        },
      ],
    });
    expect(plan).toEqual([
      {
        storeVariantId: "v-small",
        inwMediaIds: ["m1"],
        shopifyMediaIds: ["gid://shopify/MediaImage/1"],
      },
      {
        storeVariantId: "v-large",
        inwMediaIds: ["m2"],
        shopifyMediaIds: ["gid://shopify/MediaImage/2"],
      },
    ]);
  });

  it("allows shared media across variants without duplicating map identity", () => {
    const plan = planVariantMediaAssociations({
      variants: [
        { storeVariantId: "v-small", photos: ["https://cdn.example/a.jpg"] },
        { storeVariantId: "v-medium", photos: ["https://cdn.example/a.jpg"] },
      ],
      mediaMaps: [
        {
          inwMediaId: "m1",
          sourceUrl: "https://cdn.example/a.jpg",
          shopifyMediaId: "gid://shopify/MediaImage/1",
          status: "ACTIVE",
        },
      ],
    });
    expect(plan[0].inwMediaIds).toEqual(["m1"]);
    expect(plan[1].inwMediaIds).toEqual(["m1"]);
  });
});

describe("planVariantMediaInboundAssociations", () => {
  it("A/B: maps by ProductVariant GID + Media GID only (never SKU); isolates variants", () => {
    const plan = planVariantMediaInboundAssociations({
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
        { storeVariantId: "sv-2", shopifyVariantId: "gid://shopify/ProductVariant/2" },
        { storeVariantId: "sv-3", shopifyVariantId: "gid://shopify/ProductVariant/3" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/2",
          shopifyMediaIds: ["gid://shopify/MediaImage/9"],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/8"],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/3",
          shopifyMediaIds: ["gid://shopify/MediaImage/7"],
        },
      ],
      mediaMaps: [
        {
          inwMediaId: "m8",
          sourceUrl: "https://cdn.example/a.jpg",
          shopifyMediaId: "gid://shopify/MediaImage/8",
          status: "ACTIVE",
        },
        {
          inwMediaId: "m9",
          sourceUrl: "https://cdn.example/b.jpg",
          shopifyMediaId: "gid://shopify/MediaImage/9",
          status: "ACTIVE",
        },
        {
          inwMediaId: "m7",
          sourceUrl: "https://cdn.example/c.jpg",
          shopifyMediaId: "gid://shopify/MediaImage/7",
          status: "ACTIVE",
        },
      ],
    });
    expect(plan[0].photos).toEqual(["https://cdn.example/a.jpg"]);
    expect(plan[1].photos).toEqual(["https://cdn.example/b.jpg"]);
    expect(plan[2].photos).toEqual(["https://cdn.example/c.jpg"]);
  });

  it("C: empty remote mediaIds means disassociation (no unresolved)", () => {
    const plan = planVariantMediaInboundAssociations({
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        { shopifyVariantId: "gid://shopify/ProductVariant/1", shopifyMediaIds: [] },
      ],
      mediaMaps: [
        {
          inwMediaId: "m1",
          sourceUrl: "https://cdn.example/a.jpg",
          shopifyMediaId: "gid://shopify/MediaImage/1",
          status: "ACTIVE",
        },
      ],
    });
    expect(plan[0]).toMatchObject({
      photos: [],
      inwMediaIds: [],
      unresolvedMediaIds: [],
    });
  });

  it("D: unresolved media GID is reported without inventing canonical media", () => {
    const plan = planVariantMediaInboundAssociations({
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/new"],
        },
      ],
      mediaMaps: [],
    });
    expect(plan[0].unresolvedMediaIds).toEqual(["gid://shopify/MediaImage/new"]);
    expect(plan[0].inwMediaIds).toEqual([]);
  });
});

describe("classifyVariantMediaInbound", () => {
  const A = "fp-a";
  const B = "fp-b";
  const C = "fp-c";

  it("G: self-echo when local===remote===base → UNCHANGED", () => {
    expect(classifyVariantMediaInbound({ base: A, local: A, remote: A })).toBe("UNCHANGED");
  });

  it("A: remote-only association change → REMOTE_ONLY", () => {
    expect(classifyVariantMediaInbound({ base: A, local: A, remote: B })).toBe("REMOTE_ONLY");
  });

  it("H: dual divergence → CONFLICT (no arbitrary winner)", () => {
    expect(classifyVariantMediaInbound({ base: A, local: B, remote: C })).toBe("CONFLICT");
  });

  it("LOCAL_ONLY when only INW changed association", () => {
    expect(classifyVariantMediaInbound({ base: A, local: B, remote: A })).toBe("LOCAL_ONLY");
  });

  it("CONVERGED when both sides match after prior divergence", () => {
    expect(classifyVariantMediaInbound({ base: A, local: B, remote: B })).toBe("CONVERGED");
  });

  it("D: skip when remote media not yet canonicalized", () => {
    expect(
      classifyVariantMediaInbound({
        base: A,
        local: A,
        remote: B,
        unresolvedRemoteMedia: true,
      })
    ).toBe("SKIP_UNMAPPED_MEDIA");
  });

  it("fingerprints are identity-stable for same media set", () => {
    const maps = [
      {
        inwMediaId: "m1",
        sourceUrl: "https://cdn.example/a.jpg",
        shopifyMediaId: "gid://shopify/MediaImage/1",
        status: "ACTIVE",
      },
    ];
    const local = variantMediaLocalFingerprint({
      photos: ["https://cdn.example/a.jpg"],
      mediaMaps: maps,
    });
    const remote = variantMediaRemoteFingerprint(["m1"]);
    expect(local).toBe(remote);
  });
});

type MediaMapRow = {
  id: string;
  inwMediaId: string;
  sourceUrl: string | null;
  shopifyMediaId: string | null;
  status: string;
  storeVariantId: string | null;
};

type FieldRow = {
  storeVariantId: string;
  baseFingerprint: string | null;
  localFingerprint: string | null;
  remoteFingerprint: string | null;
  conflict: boolean;
};

type VariantRow = { id: string; photos: string[] };

function createApplyDb(state: {
  mediaMaps: MediaMapRow[];
  fields: FieldRow[];
  variants: VariantRow[];
}) {
  const storeVariantUpdates: Array<{ id: string; photos: string[] }> = [];
  const mediaHintUpdates: Array<{ where: unknown; data: { storeVariantId: string | null } }> = [];
  const fieldUpserts: unknown[] = [];
  const fieldMarks: unknown[] = [];

  const db = {
    shopifyMediaMap: {
      findMany: vi.fn(async () => state.mediaMaps.filter((m) => m.status === "ACTIVE")),
      updateMany: vi.fn(async (args: { where: unknown; data: { storeVariantId: string | null } }) => {
        mediaHintUpdates.push(args);
        const where = args.where as {
          shopifyListingLinkId?: string;
          storeVariantId?: string;
          inwMediaId?: string;
        };
        for (const row of state.mediaMaps) {
          if (where.storeVariantId != null && row.storeVariantId === where.storeVariantId) {
            row.storeVariantId = args.data.storeVariantId;
          }
          if (where.inwMediaId != null && row.inwMediaId === where.inwMediaId) {
            row.storeVariantId = args.data.storeVariantId;
          }
        }
        return { count: 1 };
      }),
    },
    shopifyListingFieldState: {
      findMany: vi.fn(async () => state.fields),
      upsert: vi.fn(async (args: { create: FieldRow & { storeVariantId: string }; update: Partial<FieldRow> }) => {
        fieldUpserts.push(args);
        const existing = state.fields.find((f) => f.storeVariantId === args.create.storeVariantId);
        if (existing) {
          Object.assign(existing, args.update);
        } else {
          state.fields.push({
            storeVariantId: args.create.storeVariantId,
            baseFingerprint: args.create.baseFingerprint ?? null,
            localFingerprint: args.create.localFingerprint ?? null,
            remoteFingerprint: args.create.remoteFingerprint ?? null,
            conflict: Boolean(args.create.conflict),
          });
        }
        return args.create;
      }),
      updateMany: vi.fn(async (args: {
        where: { storeVariantId?: string };
        data: Partial<FieldRow>;
      }) => {
        fieldMarks.push(args);
        for (const f of state.fields) {
          if (args.where.storeVariantId != null && f.storeVariantId !== args.where.storeVariantId) {
            continue;
          }
          Object.assign(f, args.data);
        }
        return { count: 1 };
      }),
    },
    storeVariant: {
      findFirst: vi.fn(async (args: { where: { id: string } }) => {
        const v = state.variants.find((row) => row.id === args.where.id);
        return v ? { id: v.id, photos: [...v.photos] } : null;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { photos: string[] } }) => {
        storeVariantUpdates.push({ id: args.where.id, photos: args.data.photos });
        const v = state.variants.find((row) => row.id === args.where.id);
        if (v) v.photos = [...args.data.photos];
        return { id: args.where.id };
      }),
    },
  };

  return { db: db as never, storeVariantUpdates, mediaHintUpdates, fieldUpserts, fieldMarks, state };
}

const MEDIA_A = {
  id: "map-a",
  inwMediaId: "m-a",
  sourceUrl: "https://cdn.example/a.jpg",
  shopifyMediaId: "gid://shopify/MediaImage/A",
  status: "ACTIVE",
  storeVariantId: "sv-large" as string | null,
};
const MEDIA_B = {
  id: "map-b",
  inwMediaId: "m-b",
  sourceUrl: "https://cdn.example/b.jpg",
  shopifyMediaId: "gid://shopify/MediaImage/B",
  status: "ACTIVE",
  storeVariantId: null as string | null,
};
const MEDIA_C = {
  id: "map-c",
  inwMediaId: "m-c",
  sourceUrl: "https://cdn.example/c.jpg",
  shopifyMediaId: "gid://shopify/MediaImage/C",
  status: "ACTIVE",
  storeVariantId: null as string | null,
};
const MEDIA_D = {
  id: "map-d",
  inwMediaId: "m-d",
  sourceUrl: "https://cdn.example/d.jpg",
  shopifyMediaId: "gid://shopify/MediaImage/D",
  status: "ACTIVE",
  storeVariantId: null as string | null,
};

describe("applyShopifyVariantMediaInbound", () => {
  const baseInput = {
    connectionId: "conn-1",
    listingLinkId: "link-1",
    memberId: "mem-1",
    storeItemId: "item-1",
    evidenceId: "ev-1",
  };

  it("A/B: Shopify changes only Medium association; Small/Large unchanged", async () => {
    const fpA = shopifyMediaIdentityFingerprint(["m-a"]);
    const fpB = shopifyMediaIdentityFingerprint(["m-b"]);
    const fpC = shopifyMediaIdentityFingerprint(["m-c"]);
    const { db, storeVariantUpdates, state } = createApplyDb({
      mediaMaps: [
        { ...MEDIA_A, storeVariantId: "sv-small" },
        { ...MEDIA_B, storeVariantId: "sv-medium" },
        { ...MEDIA_C, storeVariantId: "sv-large" },
        { ...MEDIA_D },
      ],
      fields: [
        {
          storeVariantId: "sv-small",
          baseFingerprint: fpA,
          localFingerprint: fpA,
          remoteFingerprint: fpA,
          conflict: false,
        },
        {
          storeVariantId: "sv-medium",
          baseFingerprint: fpB,
          localFingerprint: fpB,
          remoteFingerprint: fpB,
          conflict: false,
        },
        {
          storeVariantId: "sv-large",
          baseFingerprint: fpC,
          localFingerprint: fpC,
          remoteFingerprint: fpC,
          conflict: false,
        },
      ],
      variants: [
        { id: "sv-small", photos: ["https://cdn.example/a.jpg"] },
        { id: "sv-medium", photos: ["https://cdn.example/b.jpg"] },
        { id: "sv-large", photos: ["https://cdn.example/c.jpg"] },
      ],
    });

    const result = await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-small", shopifyVariantId: "gid://shopify/ProductVariant/S" },
        { storeVariantId: "sv-medium", shopifyVariantId: "gid://shopify/ProductVariant/M" },
        { storeVariantId: "sv-large", shopifyVariantId: "gid://shopify/ProductVariant/L" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/S",
          shopifyMediaIds: ["gid://shopify/MediaImage/A"],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/M",
          shopifyMediaIds: ["gid://shopify/MediaImage/D"],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/L",
          shopifyMediaIds: ["gid://shopify/MediaImage/C"],
        },
      ],
    });

    expect(result.action).toBe("VARIANT_MEDIA_APPLIED");
    expect(result.updatedVariants).toBe(1);
    expect(storeVariantUpdates).toEqual([
      { id: "sv-medium", photos: ["https://cdn.example/d.jpg"] },
    ]);
    expect(state.variants.find((v) => v.id === "sv-small")!.photos).toEqual([
      "https://cdn.example/a.jpg",
    ]);
    expect(state.variants.find((v) => v.id === "sv-large")!.photos).toEqual([
      "https://cdn.example/c.jpg",
    ]);
  });

  it("C: disassociation clears Variant photos; product media maps remain ACTIVE", async () => {
    const fpA = shopifyMediaIdentityFingerprint(["m-a"]);
    const { db, storeVariantUpdates, state } = createApplyDb({
      mediaMaps: [{ ...MEDIA_A, storeVariantId: "sv-1" }],
      fields: [
        {
          storeVariantId: "sv-1",
          baseFingerprint: fpA,
          localFingerprint: fpA,
          remoteFingerprint: fpA,
          conflict: false,
        },
      ],
      variants: [{ id: "sv-1", photos: ["https://cdn.example/a.jpg"] }],
    });

    const result = await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        { shopifyVariantId: "gid://shopify/ProductVariant/1", shopifyMediaIds: [] },
      ],
    });

    expect(result.updatedVariants).toBe(1);
    expect(storeVariantUpdates[0]).toEqual({ id: "sv-1", photos: [] });
    expect(state.mediaMaps[0].status).toBe("ACTIVE");
    expect(state.mediaMaps[0].inwMediaId).toBe("m-a");
  });

  it("D: new media + association waits until Media GID is mapped (no invent)", async () => {
    const fpA = shopifyMediaIdentityFingerprint(["m-a"]);
    const { db, storeVariantUpdates } = createApplyDb({
      mediaMaps: [{ ...MEDIA_A }],
      fields: [
        {
          storeVariantId: "sv-1",
          baseFingerprint: fpA,
          localFingerprint: fpA,
          remoteFingerprint: fpA,
          conflict: false,
        },
      ],
      variants: [{ id: "sv-1", photos: ["https://cdn.example/a.jpg"] }],
    });

    const pending = await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/NEW"],
        },
      ],
    });
    expect(pending.action).toBe("VARIANT_MEDIA_PENDING_MEDIA");
    expect(storeVariantUpdates).toHaveLength(0);

    // After product-media ingest maps the new GID, association applies once.
    const { db: db2, storeVariantUpdates: updates2 } = createApplyDb({
      mediaMaps: [
        { ...MEDIA_A },
        {
          id: "map-new",
          inwMediaId: "m-new",
          sourceUrl: "https://cdn.example/new.jpg",
          shopifyMediaId: "gid://shopify/MediaImage/NEW",
          status: "ACTIVE",
          storeVariantId: null,
        },
      ],
      fields: [
        {
          storeVariantId: "sv-1",
          baseFingerprint: fpA,
          localFingerprint: fpA,
          remoteFingerprint: fpA,
          conflict: false,
        },
      ],
      variants: [{ id: "sv-1", photos: ["https://cdn.example/a.jpg"] }],
    });
    const applied = await applyShopifyVariantMediaInbound(db2, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/NEW"],
        },
      ],
    });
    expect(applied.updatedVariants).toBe(1);
    expect(updates2[0].photos).toEqual(["https://cdn.example/new.jpg"]);
  });

  it("E/F: duplicate PRODUCTS_UPDATE / reconcile replay is idempotent echo", async () => {
    const fpB = shopifyMediaIdentityFingerprint(["m-b"]);
    const { db, storeVariantUpdates } = createApplyDb({
      mediaMaps: [{ ...MEDIA_B, storeVariantId: "sv-1" }],
      fields: [
        {
          storeVariantId: "sv-1",
          baseFingerprint: fpB,
          localFingerprint: fpB,
          remoteFingerprint: fpB,
          conflict: false,
        },
      ],
      variants: [{ id: "sv-1", photos: ["https://cdn.example/b.jpg"] }],
    });

    const first = await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/B"],
        },
      ],
    });
    const second = await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/B"],
        },
      ],
    });

    expect(first.action).toBe("VARIANT_MEDIA_ECHO");
    expect(second.action).toBe("VARIANT_MEDIA_ECHO");
    expect(first.echoes).toBe(1);
    expect(second.echoes).toBe(1);
    expect(storeVariantUpdates).toHaveLength(0);
  });

  it("G: outbound self-echo (BASE=LOCAL=REMOTE) confirms without mutating photos", async () => {
    const fpA = shopifyMediaIdentityFingerprint(["m-a"]);
    const { db, storeVariantUpdates } = createApplyDb({
      mediaMaps: [{ ...MEDIA_A, storeVariantId: "sv-1" }],
      fields: [
        {
          storeVariantId: "sv-1",
          baseFingerprint: fpA,
          localFingerprint: fpA,
          remoteFingerprint: fpA,
          conflict: false,
        },
      ],
      variants: [{ id: "sv-1", photos: ["https://cdn.example/a.jpg"] }],
    });

    const result = await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/A"],
        },
      ],
    });
    expect(result.action).toBe("VARIANT_MEDIA_ECHO");
    expect(result.updatedVariants).toBe(0);
    expect(storeVariantUpdates).toHaveLength(0);
  });

  it("H: INW and Shopify independently choose different media → CONFLICT", async () => {
    const fpA = shopifyMediaIdentityFingerprint(["m-a"]);
    const fpB = shopifyMediaIdentityFingerprint(["m-b"]);
    const fpC = shopifyMediaIdentityFingerprint(["m-c"]);
    const { db, storeVariantUpdates, state } = createApplyDb({
      mediaMaps: [{ ...MEDIA_A }, { ...MEDIA_B }, { ...MEDIA_C }],
      fields: [
        {
          storeVariantId: "sv-1",
          baseFingerprint: fpA,
          localFingerprint: fpB,
          remoteFingerprint: fpA,
          conflict: false,
        },
      ],
      variants: [{ id: "sv-1", photos: ["https://cdn.example/b.jpg"] }],
    });

    const result = await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/C"],
        },
      ],
    });

    expect(result.action).toBe("VARIANT_MEDIA_CONFLICT");
    expect(result.conflicts).toBe(1);
    expect(storeVariantUpdates).toHaveLength(0);
    expect(state.variants[0].photos).toEqual(["https://cdn.example/b.jpg"]);
    expect(state.fields[0].conflict).toBe(true);
    void fpC;
  });

  it("I: variant REMOTE_ONLY pull does not require product-media field change", async () => {
    // Independent: product-level media addition (C) lives on StoreItem / product MEDIA "";
    // variant association change A→B is applied on StoreVariant.photos only.
    const fpA = shopifyMediaIdentityFingerprint(["m-a"]);
    const { db, storeVariantUpdates, state } = createApplyDb({
      mediaMaps: [{ ...MEDIA_A }, { ...MEDIA_B }, { ...MEDIA_C }],
      fields: [
        {
          storeVariantId: "sv-1",
          baseFingerprint: fpA,
          localFingerprint: fpA,
          remoteFingerprint: fpA,
          conflict: false,
        },
      ],
      variants: [{ id: "sv-1", photos: ["https://cdn.example/a.jpg"] }],
    });

    const result = await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/B"],
        },
      ],
    });

    expect(result.updatedVariants).toBe(1);
    expect(storeVariantUpdates[0].photos).toEqual(["https://cdn.example/b.jpg"]);
    // Product media maps for A and C remain; association is not media deletion.
    expect(state.mediaMaps.map((m) => m.inwMediaId).sort()).toEqual(["m-a", "m-b", "m-c"]);
    expect(state.mediaMaps.every((m) => m.status === "ACTIVE")).toBe(true);
  });

  it("J: unmapped remote Variant is skipped until topology maps it (then applies)", async () => {
    const { db: db1, storeVariantUpdates: u1 } = createApplyDb({
      mediaMaps: [{ ...MEDIA_A }],
      fields: [],
      variants: [],
    });
    const skipped = await applyShopifyVariantMediaInbound(db1, {
      ...baseInput,
      mappedVariants: [],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/NEW",
          shopifyMediaIds: ["gid://shopify/MediaImage/A"],
        },
      ],
    });
    expect(skipped.action).toBe("VARIANT_MEDIA_SKIPPED");
    expect(u1).toHaveLength(0);

    const { db: db2, storeVariantUpdates: u2 } = createApplyDb({
      mediaMaps: [{ ...MEDIA_A }],
      fields: [],
      variants: [{ id: "sv-new", photos: [] }],
    });
    const applied = await applyShopifyVariantMediaInbound(db2, {
      ...baseInput,
      mappedVariants: [
        {
          storeVariantId: "sv-new",
          shopifyVariantId: "gid://shopify/ProductVariant/NEW",
        },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/NEW",
          shopifyMediaIds: ["gid://shopify/MediaImage/A"],
        },
      ],
    });
    expect(applied.updatedVariants).toBe(1);
    expect(u2[0]).toEqual({ id: "sv-new", photos: ["https://cdn.example/a.jpg"] });
  });

  it("K: old-generation / unlisted Variant mapping cannot mutate current association", async () => {
    const fpA = shopifyMediaIdentityFingerprint(["m-a"]);
    const { db, storeVariantUpdates, state } = createApplyDb({
      mediaMaps: [{ ...MEDIA_A, storeVariantId: "sv-current" }],
      fields: [
        {
          storeVariantId: "sv-current",
          baseFingerprint: fpA,
          localFingerprint: fpA,
          remoteFingerprint: fpA,
          conflict: false,
        },
      ],
      variants: [
        { id: "sv-current", photos: ["https://cdn.example/a.jpg"] },
        { id: "sv-retired", photos: ["https://cdn.example/a.jpg"] },
      ],
    });

    // Caller only passes current-generation maps (retired omitted).
    await applyShopifyVariantMediaInbound(db, {
      ...baseInput,
      mappedVariants: [
        {
          storeVariantId: "sv-current",
          shopifyVariantId: "gid://shopify/ProductVariant/CUR",
        },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/CUR",
          shopifyMediaIds: ["gid://shopify/MediaImage/A"],
        },
        {
          shopifyVariantId: "gid://shopify/ProductVariant/OLD",
          shopifyMediaIds: ["gid://shopify/MediaImage/B"],
        },
      ],
    });

    expect(storeVariantUpdates).toHaveLength(0);
    expect(state.variants.find((v) => v.id === "sv-retired")!.photos).toEqual([
      "https://cdn.example/a.jpg",
    ]);
    expect(state.variants.find((v) => v.id === "sv-current")!.photos).toEqual([
      "https://cdn.example/a.jpg",
    ]);
  });

  it("L: seedShopifyVariantMediaConvergence sets BASE=LOCAL=REMOTE without outbound", async () => {
    const { db, storeVariantUpdates, fieldUpserts, fieldMarks, state } = createApplyDb({
      mediaMaps: [
        { ...MEDIA_A, storeVariantId: null },
        { ...MEDIA_B, storeVariantId: null },
      ],
      fields: [],
      variants: [
        { id: "sv-s", photos: [] },
        { id: "sv-m", photos: [] },
      ],
    });

    await seedShopifyVariantMediaConvergence(db, {
      connectionId: "conn-1",
      listingLinkId: "link-1",
      memberId: "mem-1",
      storeItemId: "item-1",
      associations: [
        {
          storeVariantId: "sv-s",
          photos: ["https://cdn.example/a.jpg"],
          inwMediaIds: ["m-a"],
        },
        {
          storeVariantId: "sv-m",
          photos: ["https://cdn.example/b.jpg"],
          inwMediaIds: ["m-b"],
        },
      ],
    });

    expect(storeVariantUpdates).toHaveLength(2);
    expect(fieldUpserts.length).toBeGreaterThan(0);
    expect(fieldMarks.length).toBeGreaterThan(0);
    const fpA = shopifyMediaIdentityFingerprint(["m-a"]);
    expect(state.fields.find((f) => f.storeVariantId === "sv-s")?.baseFingerprint).toBe(fpA);
    expect(state.fields.find((f) => f.storeVariantId === "sv-s")?.localFingerprint).toBe(fpA);
    expect(state.fields.find((f) => f.storeVariantId === "sv-s")?.conflict).toBe(false);
  });
});
