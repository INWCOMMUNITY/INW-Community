import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  resolveEtsyHowItsMadeForCreate,
  ETSY_WHO_MADE_LABELS,
} from "database";
import {
  ETSY_DEFAULT_PACKAGE,
  resolveEtsyListingPackageFields,
} from "./listing-package";

describe("resolveEtsyListingPackageFields", () => {
  it("defaults when no shipping option measurements exist", () => {
    const pkg = resolveEtsyListingPackageFields(null);
    expect(pkg.source).toBe("default");
    expect(pkg.item_weight).toBe(ETSY_DEFAULT_PACKAGE.weightOz);
    expect(pkg.item_weight_unit).toBe("oz");
    expect(pkg.item_length).toBe(ETSY_DEFAULT_PACKAGE.lengthIn);
    expect(pkg.item_width).toBe(ETSY_DEFAULT_PACKAGE.widthIn);
    expect(pkg.item_height).toBe(ETSY_DEFAULT_PACKAGE.heightIn);
    expect(pkg.item_dimensions_unit).toBe("in");
  });

  it("uses shipping option measurements when complete", () => {
    const pkg = resolveEtsyListingPackageFields({
      weightOz: 12,
      lengthIn: 10,
      widthIn: 7,
      heightIn: 3,
    });
    expect(pkg.source).toBe("shipping_option");
    expect(pkg.item_weight).toBe(12);
    expect(pkg.item_length).toBe(10);
    expect(pkg.item_width).toBe(7);
    expect(pkg.item_height).toBe(3);
  });

  it("fills missing measurements from defaults", () => {
    const pkg = resolveEtsyListingPackageFields({
      weightOz: 16,
      lengthIn: null,
      widthIn: 5,
      heightIn: null,
    });
    expect(pkg.source).toBe("mixed");
    expect(pkg.item_weight).toBe(16);
    expect(pkg.item_width).toBe(5);
    expect(pkg.item_length).toBe(ETSY_DEFAULT_PACKAGE.lengthIn);
    expect(pkg.item_height).toBe(ETSY_DEFAULT_PACKAGE.heightIn);
  });
});

describe("resolveEtsyHowItsMadeForCreate", () => {
  it("requires who, what, when, and taxonomy", () => {
    const result = resolveEtsyHowItsMadeForCreate({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("HOW_ITS_MADE_REQUIRED");
      expect(result.missing).toEqual(
        expect.arrayContaining(["who_made", "when_made", "is_supply", "taxonomy_id"])
      );
    }
  });

  it("auto-fills when_made from made_to_order inventory tracking", () => {
    const result = resolveEtsyHowItsMadeForCreate({
      etsyWhoMade: "i_did",
      etsyIsSupply: false,
      etsyTaxonomyId: 1234,
      inventoryTracking: "made_to_order",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.whenMade).toBe("made_to_order");
      expect(result.whoMade).toBe("i_did");
      expect(result.isSupply).toBe(false);
      expect(result.taxonomyId).toBe(1234);
    }
  });

  it("uses connection/env default taxonomy when listing omits one", () => {
    const result = resolveEtsyHowItsMadeForCreate({
      etsyWhoMade: "collective",
      etsyWhenMade: "2020_2026",
      etsyIsSupply: true,
      defaultTaxonomyId: 99,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.taxonomyId).toBe(99);
  });

  it("maps who_made labels to Etsy Shop Manager copy", () => {
    expect(ETSY_WHO_MADE_LABELS.i_did).toBe("I did");
    expect(ETSY_WHO_MADE_LABELS.collective).toBe("A member of my shop");
    expect(ETSY_WHO_MADE_LABELS.someone_else).toBe("Another company or person");
  });
});

describe("sanitizeEtsyTaxonomyId", () => {
  it("rejects the old bogus platform default", async () => {
    const { sanitizeEtsyTaxonomyId, resolveEtsyTaxonomyFallback } = await import(
      "./taxonomy-default"
    );
    expect(sanitizeEtsyTaxonomyId(69150467)).toBeNull();
    expect(resolveEtsyTaxonomyFallback(69150467)).toBe(101);
    expect(resolveEtsyTaxonomyFallback(null)).toBe(101);
  });
});

vi.mock("database", async () => {
  const actual = await vi.importActual<typeof import("database")>("database");
  return {
    ...actual,
    prisma: {
      etsyConnection: { findFirst: vi.fn() },
      etsyListingLink: { findUnique: vi.fn() },
      storeItem: { findFirst: vi.fn() },
      storeVariant: { findMany: vi.fn() },
      etsySyncJob: {},
    },
    enqueueEtsySyncJob: vi.fn(),
  };
});

import { enqueueEtsySyncJob, prisma } from "database";
import { enqueueEtsyCreateListing } from "./create-listing";

describe("enqueueEtsyCreateListing gates", () => {
  beforeEach(() => {
    vi.mocked(prisma.etsyConnection.findFirst).mockReset();
    vi.mocked(prisma.etsyListingLink.findUnique).mockReset();
    vi.mocked(prisma.storeItem.findFirst).mockReset();
    vi.mocked(prisma.storeVariant.findMany).mockReset();
    vi.mocked(enqueueEtsySyncJob).mockReset();
  });

  it("rejects when How it's made is incomplete", async () => {
    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      defaultTaxonomyId: null,
      defaultShippingProfileId: "sp-1",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      status: "active",
      title: "Mug",
      description: "Nice",
      priceCents: 1200,
      quantity: 2,
      inventoryTracking: "tracked",
      etsyWhoMade: null,
      etsyWhenMade: null,
      etsyIsSupply: null,
      etsyTaxonomyId: null,
    } as never);

    const result = await enqueueEtsyCreateListing({ memberId: "m1", storeItemId: "item-1" });
    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") {
      expect(result.code).toBe("HOW_ITS_MADE_REQUIRED");
      expect(result.missing).toContain("who_made");
    }
    expect(enqueueEtsySyncJob).not.toHaveBeenCalled();
  });

  it("rejects when shipping profile is missing", async () => {
    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      defaultTaxonomyId: 10,
      defaultShippingProfileId: null,
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      status: "active",
      title: "Mug",
      description: "Nice",
      priceCents: 1200,
      quantity: 2,
      inventoryTracking: "tracked",
      etsyWhoMade: "i_did",
      etsyWhenMade: "2020_2026",
      etsyIsSupply: false,
      etsyTaxonomyId: 10,
    } as never);

    const result = await enqueueEtsyCreateListing({ memberId: "m1", storeItemId: "item-1" });
    expect(result.status).toBe("ERROR");
    if (result.status === "ERROR") expect(result.code).toBe("SHIPPING_PROFILE_REQUIRED");
  });

  it("queues CREATE_LISTING when gates pass", async () => {
    vi.mocked(prisma.etsyConnection.findFirst).mockResolvedValue({
      id: "conn-1",
      defaultTaxonomyId: 10,
      defaultShippingProfileId: "sp-1",
    } as never);
    vi.mocked(prisma.etsyListingLink.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.storeItem.findFirst).mockResolvedValue({
      id: "item-1",
      status: "active",
      title: "Mug",
      description: "Nice",
      priceCents: 1200,
      quantity: 2,
      inventoryTracking: "tracked",
      etsyWhoMade: "i_did",
      etsyWhenMade: "2020_2026",
      etsyIsSupply: false,
      etsyTaxonomyId: 10,
    } as never);
    vi.mocked(prisma.storeVariant.findMany).mockResolvedValue([{ id: "var-1" }] as never);
    vi.mocked(enqueueEtsySyncJob).mockResolvedValue({ id: "job-1" } as never);

    const result = await enqueueEtsyCreateListing({ memberId: "m1", storeItemId: "item-1" });
    expect(result.status).toBe("QUEUED");
    expect(enqueueEtsySyncJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "CREATE_LISTING",
        etsyConnectionId: "conn-1",
      })
    );
  });
});
