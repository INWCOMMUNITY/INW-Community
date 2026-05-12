import { prisma } from "database";
import type { LiveSocketMessagePayload } from "@/lib/chat-live-types";

type MessageRow = {
  id: string;
  senderId: string;
  content: string;
  createdAt: Date;
  sharedContentType?: string | null;
  sharedContentId?: string | null;
  sharedContentSlug?: string | null;
  sender: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
};

export async function buildDirectMessageLivePayload(
  conversationId: string,
  m: MessageRow
): Promise<LiveSocketMessagePayload> {
  const base: LiveSocketMessagePayload = {
    conversationId,
    messageId: m.id,
    senderId: m.senderId,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    sender: {
      id: m.sender.id,
      firstName: m.sender.firstName,
      lastName: m.sender.lastName,
      profilePhotoUrl: m.sender.profilePhotoUrl,
    },
    sharedContentType: m.sharedContentType ?? null,
    sharedContentId: m.sharedContentId ?? null,
    sharedContentSlug: m.sharedContentSlug ?? null,
  };

  if (m.sharedContentType === "event" && m.sharedContentId) {
    const ev = await prisma.event.findUnique({
      where: { id: m.sharedContentId },
      select: { id: true, title: true, slug: true, photos: true },
    });
    if (ev) {
      base.sharedEvent = {
        id: ev.id,
        title: ev.title,
        slug: ev.slug,
        coverPhotoUrl: ev.photos[0] ?? null,
      };
    }
  }

  if (m.sharedContentType === "store_item" && m.sharedContentId) {
    const si = await prisma.storeItem.findUnique({
      where: { id: m.sharedContentId },
      select: { id: true, title: true, slug: true, photos: true, listingType: true },
    });
    if (si) {
      base.sharedStoreItem = {
        id: si.id,
        title: si.title,
        slug: si.slug,
        coverPhotoUrl: si.photos[0] ?? null,
        listingType: si.listingType,
      };
    }
  }

  if (m.sharedContentType === "business" && m.sharedContentId) {
    const b = await prisma.business.findUnique({
      where: { id: m.sharedContentId },
      select: { id: true, name: true, slug: true, logoUrl: true, shortDescription: true },
    });
    if (b) {
      base.sharedBusiness = {
        id: b.id,
        name: b.name,
        slug: b.slug,
        logoUrl: b.logoUrl,
        shortDescription: b.shortDescription,
      };
    }
  }

  return base;
}
