import { describe, expect, it } from "vitest";
import { planVariantMediaAssociations } from "./variant-media";

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
