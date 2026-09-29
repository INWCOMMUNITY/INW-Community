import { describe, expect, it } from "vitest";
import {
  planVariantMediaAssociations,
  planVariantMediaInboundAssociations,
} from "./variant-media";

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
});

describe("planVariantMediaInboundAssociations", () => {
  it("maps by ProductVariant GID + Media GID only (never SKU)", () => {
    const plan = planVariantMediaInboundAssociations({
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
        { storeVariantId: "sv-2", shopifyVariantId: "gid://shopify/ProductVariant/2" },
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
      ],
    });
    expect(plan).toEqual([
      {
        storeVariantId: "sv-1",
        shopifyVariantId: "gid://shopify/ProductVariant/1",
        photos: ["https://cdn.example/a.jpg"],
        inwMediaIds: ["m8"],
        shopifyMediaIds: ["gid://shopify/MediaImage/8"],
      },
      {
        storeVariantId: "sv-2",
        shopifyVariantId: "gid://shopify/ProductVariant/2",
        photos: ["https://cdn.example/b.jpg"],
        inwMediaIds: ["m9"],
        shopifyMediaIds: ["gid://shopify/MediaImage/9"],
      },
    ]);
  });

  it("ignores unmapped media GIDs and does not invent associations", () => {
    const plan = planVariantMediaInboundAssociations({
      mappedVariants: [
        { storeVariantId: "sv-1", shopifyVariantId: "gid://shopify/ProductVariant/1" },
      ],
      remoteVariantMedia: [
        {
          shopifyVariantId: "gid://shopify/ProductVariant/1",
          shopifyMediaIds: ["gid://shopify/MediaImage/missing"],
        },
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
      storeVariantId: "sv-1",
      photos: [],
      inwMediaIds: [],
      shopifyMediaIds: [],
    });
  });
});
