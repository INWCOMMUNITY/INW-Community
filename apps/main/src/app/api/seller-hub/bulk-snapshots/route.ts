import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

interface SnapshotSummary {
  id: string;
  operation: string;
  itemCount: number;
  canUndo: boolean;
  undoneAt: string | null;
  expiresAt: string;
  createdAt: string;
  isExpired: boolean;
  itemTitles?: string[];
}

/**
 * GET /api/seller-hub/bulk-snapshots
 * 
 * Get recent bulk operation snapshots for the current seller (last 24 hours).
 */
export async function GET(req: NextRequest) {
  try {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Fetch recent snapshots (not yet expired or recently expired)
  const snapshots = await prisma.bulkEditSnapshot.findMany({
    where: {
      memberId: session.user.id,
      createdAt: {
        gte: new Date(now.getTime() - 48 * 60 * 60 * 1000), // Last 48 hours
      },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const summaries: SnapshotSummary[] = snapshots.map((s) => {
    const isExpired = new Date(s.expiresAt) < now;
    
    // Extract item titles from changes if available
    let itemTitles: string[] = [];
    try {
      const changes = s.changes as Record<string, { before?: { title?: string } }>;
      itemTitles = Object.values(changes)
        .map((c) => c.before?.title)
        .filter((t): t is string => Boolean(t))
        .slice(0, 5);
    } catch {
      // Ignore parsing errors
    }
    
    return {
      id: s.id,
      operation: s.operation,
      itemCount: s.itemCount,
      canUndo: s.canUndo && !isExpired && !s.undoneAt,
      undoneAt: s.undoneAt?.toISOString() ?? null,
      expiresAt: s.expiresAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      isExpired,
      itemTitles,
    };
  });

  return NextResponse.json({ snapshots: summaries });
  } catch (e) {
    console.error("[bulk-snapshots] GET error:", e);
    return NextResponse.json({ snapshots: [] });
  }
}
