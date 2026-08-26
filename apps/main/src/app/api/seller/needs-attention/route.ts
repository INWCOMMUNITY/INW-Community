import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  countNeedsAttention,
  listNeedsAttention,
} from "@/lib/channels/needs-attention";
import { isEtsyWhoMade, normalizeEtsyWhenMade } from "@/lib/etsy-listing-options";
import { CHANNEL_PROVIDERS, type ChannelProvider } from "@/lib/channels/types";
import { updateStoreItemOnChannels } from "@/lib/channels/outbound";
import { resetCircuit } from "@/lib/channels/circuit-breaker";
import { mergeConnectionConfig, getConnectionContext } from "@/lib/channels/connection";
import { normalizeEtsyOriginPostalCode, resolveEtsyShippingProfile } from "@/lib/channels/shipping-map";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/seller/needs-attention
 * Listings and shop setup the seller can complete so channel sync can proceed.
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const countOnly = req.nextUrl.searchParams.get("count") === "1";
  if (countOnly) {
    const count = await countNeedsAttention(userId);
    return NextResponse.json({ count });
  }

  const items = await listNeedsAttention(userId);
  return NextResponse.json({ items, count: items.length });
}

const postSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["listing", "shop"]),
  fields: z
    .object({
      etsyWhoMade: z.string().optional(),
      etsyWhenMade: z.string().optional(),
      etsyIsSupply: z.boolean().optional(),
      etsyTaxonomyId: z.number().int().positive().optional(),
      etsyOriginPostalCode: z.string().optional(),
    })
    .optional(),
  retry: z.boolean().optional(),
});

/**
 * POST /api/seller/needs-attention
 * Save missing fields and retry the blocked channel (not a full fan-out).
 */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { id, kind, fields, retry } = parsed.data;

  if (kind === "shop") {
    const connectionId = id.startsWith("shop:") ? id.slice(5) : id;
    const conn = await prisma.channelConnection.findFirst({
      where: { id: connectionId, memberId: userId, provider: "etsy" },
      select: { id: true, provider: true, config: true },
    });
    if (!conn) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const zip = normalizeEtsyOriginPostalCode(fields?.etsyOriginPostalCode ?? "");
    if (!zip) {
      return NextResponse.json({ error: "Enter a 5-digit US ZIP code." }, { status: 400 });
    }
    await prisma.channelConnection.update({
      where: { id: conn.id },
      data: {
        config: mergeConnectionConfig(conn.config, { etsyOriginPostalCode: zip }) as Prisma.InputJsonValue,
      },
    });
    await resetCircuit(conn.id, "etsy", userId);

    const fresh = await prisma.channelConnection.findUnique({ where: { id: conn.id } });
    if (fresh) {
      const ctx = await getConnectionContext(fresh);
      if (ctx) {
        await resolveEtsyShippingProfile(ctx, 0, { createIfMissing: true }).catch((e) => {
          console.warn("[needs-attention] Etsy shipping profile create after ZIP save failed", {
            error: String(e),
          });
        });
      }
    }

    const errorLinks = await prisma.channelListingLink.findMany({
      where: { connectionId: conn.id, provider: "etsy", syncEnabled: true, syncStatus: "error" },
      select: { storeItemId: true },
      take: 8,
    });
    const retryResults: { storeItemId: string; ok: boolean; error?: string }[] = [];
    if (retry !== false) {
      for (const link of errorLinks) {
        const results = await updateStoreItemOnChannels(link.storeItemId, {
          skipProviders: CHANNEL_PROVIDERS.filter((p) => p !== "etsy"),
          force: true,
        });
        const etsy = results.find((r) => r.provider === "etsy");
        retryResults.push({
          storeItemId: link.storeItemId,
          ok: etsy?.ok !== false,
          error: etsy?.error,
        });
      }
    }
    const items = await listNeedsAttention(userId);
    return NextResponse.json({ ok: true, items, retryResults });
  }

  const link = await prisma.channelListingLink.findFirst({
    where: { id, connection: { memberId: userId } },
    include: { connection: true, storeItem: { select: { id: true, memberId: true } } },
  });
  if (!link || link.storeItem.memberId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const provider = link.provider as ChannelProvider;
  const update: Record<string, unknown> = {};
  if (fields?.etsyWhoMade !== undefined) {
    if (!isEtsyWhoMade(fields.etsyWhoMade)) {
      return NextResponse.json({ error: "Pick who made this item." }, { status: 400 });
    }
    update.etsyWhoMade = fields.etsyWhoMade;
  }
  if (fields?.etsyWhenMade !== undefined) {
    const when = normalizeEtsyWhenMade(fields.etsyWhenMade);
    if (!when) {
      return NextResponse.json({ error: "Pick when this item was made." }, { status: 400 });
    }
    update.etsyWhenMade = when;
  }
  if (fields?.etsyIsSupply !== undefined) {
    update.etsyIsSupply = fields.etsyIsSupply;
  }
  if (fields?.etsyTaxonomyId !== undefined) {
    update.etsyTaxonomyId = fields.etsyTaxonomyId;
  }

  if (Object.keys(update).length > 0) {
    await prisma.storeItem.update({
      where: { id: link.storeItemId },
      data: update,
    });
  }

  await resetCircuit(link.connectionId, provider, userId);

  let retryResult: { ok: boolean; error?: string } | undefined;
  if (retry !== false) {
    const results = await updateStoreItemOnChannels(link.storeItemId, {
      skipProviders: CHANNEL_PROVIDERS.filter((p) => p !== provider),
      force: true,
    });
    const row = results.find((r) => r.provider === provider);
    retryResult = { ok: row?.ok !== false, error: row?.error };
  }

  const items = await listNeedsAttention(userId);
  return NextResponse.json({ ok: retryResult?.ok !== false, items, retryResult });
}
