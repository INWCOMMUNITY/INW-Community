import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = {
  channelListingLink: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  storeItem: {
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("database", () => ({
  prisma: mockPrisma,
  Prisma: { JsonNull: null },
}));

function p2002(target: string[]) {
  const err = new Error("Unique constraint failed") as Error & {
    code: string;
    meta: { target: string[] };
  };
  err.code = "P2002";
  err.meta = { target };
  return err;
}

describe("claimChannelListingLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.channelListingLink.create.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "link-1", ...data })
    );
    mockPrisma.channelListingLink.update.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "link-stolen", ...data })
    );
    mockPrisma.storeItem.delete.mockResolvedValue({});
  });

  it("creates a new link when none exists", async () => {
    const { claimChannelListingLink } = await import("./listing-link-claim");
    const result = await claimChannelListingLink({
      storeItemId: "item-1",
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      externalListingId: "wix-1",
      linkOrigin: "inw_create",
    });
    expect(result.created).toBe(true);
    expect(result.stolenFromStoreItemId).toBeNull();
    expect(mockPrisma.channelListingLink.create).toHaveBeenCalledOnce();
  });

  it("moves a same-member auto-imported link onto the publisher and deletes the orphan", async () => {
    const { claimChannelListingLink } = await import("./listing-link-claim");
    mockPrisma.channelListingLink.create.mockRejectedValueOnce(
      p2002(["provider", "external_listing_id"])
    );
    mockPrisma.channelListingLink.findUnique.mockResolvedValueOnce({
      id: "link-stolen",
      storeItemId: "orphan-item",
      storeItem: { memberId: "member-1" },
    });
    mockPrisma.storeItem.findUnique.mockResolvedValueOnce({
      _count: { channelLinks: 0, orderItems: 0 },
    });

    const result = await claimChannelListingLink({
      storeItemId: "item-1",
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      externalListingId: "wix-1",
      linkOrigin: "inw_create",
    });

    expect(result.created).toBe(false);
    expect(result.stolenFromStoreItemId).toBe("orphan-item");
    expect(result.storeItemId).toBe("item-1");
    expect(mockPrisma.channelListingLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "link-stolen" },
        data: expect.objectContaining({ storeItemId: "item-1", connectionId: "conn-1" }),
      })
    );
    expect(mockPrisma.storeItem.delete).toHaveBeenCalledWith({ where: { id: "orphan-item" } });
  });

  it("treats a same-item unique collision as success", async () => {
    const { claimChannelListingLink } = await import("./listing-link-claim");
    mockPrisma.channelListingLink.create.mockRejectedValueOnce(
      p2002(["store_item_id", "provider"])
    );
    mockPrisma.channelListingLink.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "link-existing",
        storeItemId: "item-1",
        externalListingId: "wix-already",
      });

    const result = await claimChannelListingLink({
      storeItemId: "item-1",
      memberId: "member-1",
      connectionId: "conn-1",
      provider: "wix",
      externalListingId: "wix-new",
    });

    expect(result.created).toBe(false);
    expect(result.stolenFromStoreItemId).toBeNull();
    expect(mockPrisma.channelListingLink.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ externalListingId: "wix-already" }),
      })
    );
    expect(mockPrisma.storeItem.delete).not.toHaveBeenCalled();
  });

  it("throws when another member already owns the remote listing", async () => {
    const { claimChannelListingLink } = await import("./listing-link-claim");
    mockPrisma.channelListingLink.create.mockRejectedValueOnce(
      p2002(["provider", "external_listing_id"])
    );
    mockPrisma.channelListingLink.findUnique.mockResolvedValueOnce({
      id: "link-other",
      storeItemId: "other-item",
      storeItem: { memberId: "member-other" },
    });

    await expect(
      claimChannelListingLink({
        storeItemId: "item-1",
        memberId: "member-1",
        connectionId: "conn-1",
        provider: "wix",
        externalListingId: "wix-1",
      })
    ).rejects.toThrow(/another INW account/i);
  });
});
