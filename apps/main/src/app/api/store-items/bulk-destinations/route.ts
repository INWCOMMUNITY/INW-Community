import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionForApi } from "@/lib/mobile-auth";
import { applyBulkDestinations, parseDestinationAssignments } from "@/lib/store-item-apply-bulk-destinations";
import type { BulkDestinationAction } from "@/lib/store-item-bulk-destinations";

export const dynamic = "force-dynamic";

const categoryAssignmentSchema = z.object({
  storeItemId: z.string(),
  etsyTaxonomyId: z.number().int().positive().optional(),
  ebayCategoryId: z.number().int().positive().optional(),
  etsyWhoMade: z.string().min(1).optional(),
  etsyWhenMade: z.string().min(1).optional(),
});

const bodySchema = z.object({
  action: z.enum(["sync", "end", "delete"]),
  items: z.array(z.unknown()).min(1).max(50),
  assignments: z.array(categoryAssignmentSchema).optional(),
});

/**
 * POST /api/store-items/bulk-destinations
 *
 * Per-item INW + channel assignments for Manage Listings.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionForApi(req);
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const assignments = parseDestinationAssignments(parsed.data.items);
    if (!assignments) {
      return NextResponse.json({ error: "Invalid item assignments" }, { status: 400 });
    }

    const action = parsed.data.action as BulkDestinationAction;
    const result = await applyBulkDestinations({
      memberId: userId,
      action,
      assignments,
      categoryAssignments: parsed.data.assignments,
    });

    return NextResponse.json(result);
  } catch (e) {
    console.error("[bulk-destinations] error:", e);
    return NextResponse.json(
      { error: "Bulk destinations failed", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
