import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { prisma } from "database";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SOURCE_OF_TRUTH_VALUES = ["inw", "wix", "ebay", "etsy", "shopify"] as const;
const CONFLICT_RESOLUTION_VALUES = ["most_recent", "inw_wins", "manual_review"] as const;

type SyncPreferencesResponse = {
  syncEnabled: boolean;
  sourceOfTruth: string;
  conflictResolution: string;
  safetyBuffer: number;
  lowStockAlertThreshold: number;
  syncZeroQuantity: boolean;
  syncTitles: boolean;
  syncDescriptions: boolean;
  syncPhotos: boolean;
  syncPrices: boolean;
  syncShipping: boolean;
};

/**
 * GET /api/seller/sync-preferences
 *
 * Get the seller's sync preferences. Returns defaults if not yet configured.
 *
 * Response:
 * {
 *   syncEnabled: boolean,
 *   sourceOfTruth: "inw" | "wix" | "ebay" | "etsy" | "shopify",
 *   conflictResolution: "most_recent" | "inw_wins" | "manual_review",
 *   safetyBuffer: number,
 *   lowStockAlertThreshold: number,
 *   syncZeroQuantity: boolean,
 *   syncTitles: boolean,
 *   syncDescriptions: boolean,
 *   syncPhotos: boolean,
 *   syncPrices: boolean,
 *   syncShipping: boolean
 * }
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const prefs = await prisma.memberSyncPreferences.findUnique({
      where: { memberId: userId },
    });

    // Return existing preferences or defaults
    const response: SyncPreferencesResponse = {
      syncEnabled: prefs?.syncEnabled ?? true,
      sourceOfTruth: prefs?.sourceOfTruth ?? "inw",
      conflictResolution: prefs?.conflictResolution ?? "most_recent",
      safetyBuffer: prefs?.safetyBuffer ?? 0,
      lowStockAlertThreshold: prefs?.lowStockAlertThreshold ?? 0,
      syncZeroQuantity: prefs?.syncZeroQuantity ?? true,
      syncTitles: prefs?.syncTitles ?? true,
      syncDescriptions: prefs?.syncDescriptions ?? true,
      syncPhotos: prefs?.syncPhotos ?? true,
      syncPrices: prefs?.syncPrices ?? true,
      syncShipping: prefs?.syncShipping ?? true,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error("[sync-preferences] GET error:", e);
    return NextResponse.json(
      { error: "Failed to fetch sync preferences" },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  syncEnabled: z.boolean().optional(),
  sourceOfTruth: z.enum(SOURCE_OF_TRUTH_VALUES).optional(),
  conflictResolution: z.enum(CONFLICT_RESOLUTION_VALUES).optional(),
  safetyBuffer: z.number().int().min(0).max(10000).optional(),
  lowStockAlertThreshold: z.number().int().min(0).max(1000).optional(),
  syncZeroQuantity: z.boolean().optional(),
  syncTitles: z.boolean().optional(),
  syncDescriptions: z.boolean().optional(),
  syncPhotos: z.boolean().optional(),
  syncPrices: z.boolean().optional(),
  syncShipping: z.boolean().optional(),
});

/**
 * PATCH /api/seller/sync-preferences
 *
 * Update the seller's sync preferences. Creates preferences if they don't exist.
 *
 * Request body (all fields optional):
 * {
 *   syncEnabled?: boolean,
 *   sourceOfTruth?: "inw" | "wix" | "ebay" | "etsy" | "shopify",
 *   conflictResolution?: "most_recent" | "inw_wins" | "manual_review",
 *   safetyBuffer?: number,
 *   lowStockAlertThreshold?: number,
 *   syncZeroQuantity?: boolean,
 *   syncTitles?: boolean,
 *   syncDescriptions?: boolean,
 *   syncPhotos?: boolean,
 *   syncPrices?: boolean,
 *   syncShipping?: boolean
 * }
 *
 * Response: Updated preferences object (same shape as GET)
 */
export async function PATCH(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
    const prefs = await prisma.memberSyncPreferences.upsert({
      where: { memberId: userId },
      update: updates,
      create: {
        memberId: userId,
        ...updates,
      },
    });

    const response: SyncPreferencesResponse = {
      syncEnabled: prefs.syncEnabled,
      sourceOfTruth: prefs.sourceOfTruth,
      conflictResolution: prefs.conflictResolution,
      safetyBuffer: prefs.safetyBuffer,
      lowStockAlertThreshold: prefs.lowStockAlertThreshold,
      syncZeroQuantity: prefs.syncZeroQuantity,
      syncTitles: prefs.syncTitles,
      syncDescriptions: prefs.syncDescriptions,
      syncPhotos: prefs.syncPhotos,
      syncPrices: prefs.syncPrices,
      syncShipping: prefs.syncShipping,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error("[sync-preferences] PATCH error:", e);
    return NextResponse.json(
      { error: "Failed to update sync preferences" },
      { status: 500 }
    );
  }
}
