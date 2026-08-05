import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SYNC_DIRECTION_VALUES = ["two_way", "push_only", "pull_only", "paused"] as const;

type ChannelConfigResponse = {
  syncDirection: string;
  autoImportInbound: boolean;
  priceAdjustmentPercent: number;
  inventoryOffset: number;
};

/**
 * GET /api/channels/:id/config
 *
 * Get the sync configuration for a specific channel connection.
 *
 * Response:
 * {
 *   syncDirection: "two_way" | "push_only" | "pull_only" | "paused",
 *   autoImportInbound: boolean,
 *   priceAdjustmentPercent: number,
 *   inventoryOffset: number
 * }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const conn = await prisma.channelConnection.findUnique({
      where: { id },
      select: {
        memberId: true,
        provider: true,
        config: true,
      },
    });

    if (!conn || conn.memberId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const config = (conn.config ?? {}) as Record<string, unknown>;

    // Extract sync-related config with defaults
    const response: ChannelConfigResponse = {
      syncDirection: (config.syncDirection as string) ?? "two_way",
      autoImportInbound: config.autoImportInbound !== false, // Default true for Wix
      priceAdjustmentPercent: (config.priceAdjustmentPercent as number) ?? 0,
      inventoryOffset: (config.inventoryOffset as number) ?? 0,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error("[channel-config] GET error:", e);
    return NextResponse.json(
      { error: "Failed to fetch channel config" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  syncDirection: z.enum(SYNC_DIRECTION_VALUES).optional(),
  autoImportInbound: z.boolean().optional(),
  priceAdjustmentPercent: z.number().min(-100).max(100).optional(),
  inventoryOffset: z.number().int().min(0).max(10000).optional(),
});

/**
 * PATCH /api/channels/:id/config
 *
 * Update the sync configuration for a specific channel connection.
 *
 * Request body (all fields optional):
 * {
 *   syncDirection?: "two_way" | "push_only" | "pull_only" | "paused",
 *   autoImportInbound?: boolean,
 *   priceAdjustmentPercent?: number,
 *   inventoryOffset?: number
 * }
 *
 * Response: Updated config object (same shape as GET)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  try {
    const conn = await prisma.channelConnection.findUnique({
      where: { id },
      select: {
        memberId: true,
        config: true,
      },
    });

    if (!conn || conn.memberId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Merge updates into existing config
    const existingConfig = (conn.config ?? {}) as Record<string, unknown>;
    const newConfig = {
      ...existingConfig,
      ...updates,
    };

    await prisma.channelConnection.update({
      where: { id },
      data: { config: newConfig },
    });

    const response: ChannelConfigResponse = {
      syncDirection: (newConfig.syncDirection as string) ?? "two_way",
      autoImportInbound: newConfig.autoImportInbound !== false,
      priceAdjustmentPercent: (newConfig.priceAdjustmentPercent as number) ?? 0,
      inventoryOffset: (newConfig.inventoryOffset as number) ?? 0,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error("[channel-config] PATCH error:", e);
    return NextResponse.json(
      { error: "Failed to update channel config" },
      { status: 500 }
    );
  }
}
