import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { calculateChannelHealth, retryFailedSyncs } from "@/lib/channels/sync-health";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * GET /api/seller/sync-health
 *
 * Get health summary for all connected channels.
 *
 * Response:
 * {
 *   channels: [
 *     {
 *       provider: "etsy",
 *       connectionId: "...",
 *       connectionStatus: "active",
 *       status: "healthy" | "warning" | "error",
 *       lastSyncAt: "...",
 *       pendingRetries: 0,
 *       errorCount24h: 0,
 *       totalLinkedItems: 10,
 *       itemsWithErrors: 0,
 *       itemsWithConflicts: 0,
 *       categoriesMapped: 8,
 *       categoriesUnmapped: 2,
 *       lastError: null
 *     },
 *     ...
 *   ],
 *   overallStatus: "healthy" | "warning" | "error"
 * }
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const channels = await calculateChannelHealth(userId);

    // Determine overall status
    let overallStatus: "healthy" | "warning" | "error" = "healthy";
    for (const channel of channels) {
      if (channel.status === "error") {
        overallStatus = "error";
        break;
      } else if (channel.status === "warning" && overallStatus !== "error") {
        overallStatus = "warning";
      }
    }

    return NextResponse.json({
      channels,
      overallStatus,
    });
  } catch (e) {
    console.error("[sync-health] API error:", e);
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
 * POST /api/seller/sync-health
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
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;

  if (!userId) {
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
    // Verify the connection belongs to this user
    const { prisma } = await import("database");
    const connection = await prisma.channelConnection.findFirst({
      where: { id: data.connectionId, memberId: userId },
    });

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const result = await retryFailedSyncs(data.connectionId);
    return NextResponse.json(result);
  } catch (e) {
    console.error("[sync-health] retry error:", e);
    return NextResponse.json(
      { error: "Failed to retry syncs" },
      { status: 500 }
    );
  }
}
