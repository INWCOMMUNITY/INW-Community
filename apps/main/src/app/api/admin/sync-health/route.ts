import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getPlatformSyncHealth, retryFailedSyncs } from "@/lib/channels/sync-health";
import { prisma } from "database";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/sync-health
 *
 * Get platform-wide sync health metrics.
 *
 * Response:
 * {
 *   totalConnections: number,
 *   healthyConnections: number,
 *   warningConnections: number,
 *   errorConnections: number,
 *   totalLinkedItems: number,
 *   itemsWithErrors: number,
 *   errorLogs24h: number,
 *   byProvider: { [provider]: { connections, errors } },
 *   sellers: [
 *     { memberId, firstName, lastName, email, provider, status, linkedItems, errors, lastSyncAt }
 *   ]
 * }
 */
export async function GET(req: NextRequest) {
  const isAdmin = await requireAdmin(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const platformHealth = await getPlatformSyncHealth();

    // Get detailed seller connections for the table
    const connections = await prisma.channelConnection.findMany({
      select: {
        id: true,
        memberId: true,
        provider: true,
        status: true,
        lastError: true,
        lastReconciledAt: true,
        member: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            listingLinks: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Get error counts per connection
    const errorCounts = await prisma.channelListingLink.groupBy({
      by: ["connectionId"],
      where: { syncStatus: "error" },
      _count: { id: true },
    });

    const errorMap = new Map<string, number>();
    for (const e of errorCounts) {
      errorMap.set(e.connectionId, e._count.id);
    }

    const sellers = connections.map((c) => ({
      connectionId: c.id,
      memberId: c.memberId,
      firstName: c.member?.firstName ?? "Unknown",
      lastName: c.member?.lastName ?? "",
      email: c.member?.email ?? "",
      provider: c.provider,
      status: c.status,
      linkedItems: c._count.listingLinks,
      errors: errorMap.get(c.id) ?? 0,
      lastSyncAt: c.lastReconciledAt,
      lastError: c.lastError,
    }));

    return NextResponse.json({
      ...platformHealth,
      sellers,
    });
  } catch (e) {
    console.error("[admin-sync-health] error:", e);
    return NextResponse.json(
      { error: "Failed to fetch sync health" },
      { status: 500 }
    );
  }
}

const retrySchema = z.object({
  connectionId: z.string().min(1),
});

/**
 * POST /api/admin/sync-health
 *
 * Retry failed syncs for a connection.
 *
 * Request body:
 * { connectionId: string }
 *
 * Response:
 * { retriedCount: number }
 */
export async function POST(req: NextRequest) {
  const isAdmin = await requireAdmin(req);
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data: z.infer<typeof retrySchema>;
  try {
    const body = await req.json();
    data = retrySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  try {
    const result = await retryFailedSyncs(data.connectionId);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[admin-sync-health] retry error:", e);
    return NextResponse.json(
      { error: "Failed to retry syncs" },
      { status: 500 }
    );
  }
}
