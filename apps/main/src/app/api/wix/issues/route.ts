import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getActiveWixConnectionForMember, prisma, toPublicWixListingStatus } from "database";

export const dynamic = "force-dynamic";

export type WixListingIssue = {
  listingLinkId: string;
  storeItemId: string;
  wixProductId: string;
  title: string;
  readiness: string;
  canSync: boolean;
  issueCode: string;
  issueMessage: string;
  issueSeverity: "error" | "warning" | "info";
  issueFirstSeenAt: string;
  issueLastSeenAt: string | null;
  actionUrl: string;
};

/**
 * GET /api/wix/issues
 * Return all listings with issues for the current user.
 * Used to display notifications and action items.
 */
export async function GET(request: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);
  const severity = url.searchParams.get("severity") as "error" | "warning" | null;

  // Get active connection
  const connection = await getActiveWixConnectionForMember(prisma, session.user.id);
  if (!connection) {
    return NextResponse.json({ issues: [], total: 0 });
  }

  // Build where clause
  const where = {
    wixConnectionId: connection.id,
    issueCode: { not: null },
    ...(severity ? { issueSeverity: severity } : {}),
  };

  // Get issues
  const [issues, total] = await Promise.all([
    prisma.wixListingLink.findMany({
      where,
      select: {
        id: true,
        storeItemId: true,
        wixProductId: true,
        readiness: true,
        issueCode: true,
        issueMessage: true,
        issueSeverity: true,
        issueFirstSeenAt: true,
        issueLastSeenAt: true,
        storeItem: {
          select: {
            title: true,
          },
        },
      },
      orderBy: [
        { issueSeverity: "asc" }, // errors first
        { issueFirstSeenAt: "desc" },
      ],
      take: limit,
    }),
    prisma.wixListingLink.count({ where }),
  ]);

  const issueList: WixListingIssue[] = issues.map((issue) => {
    const publicStatus = toPublicWixListingStatus(issue);
    return {
      listingLinkId: issue.id,
      storeItemId: issue.storeItemId,
      wixProductId: issue.wixProductId,
      title: issue.storeItem?.title ?? "Unknown",
      readiness: publicStatus.readiness,
      canSync: publicStatus.canSync,
      issueCode: issue.issueCode!,
      issueMessage: issue.issueMessage ?? getDefaultIssueMessage(issue.issueCode!),
      issueSeverity: (issue.issueSeverity as "error" | "warning" | "info") ?? "warning",
      issueFirstSeenAt: issue.issueFirstSeenAt?.toISOString() ?? new Date().toISOString(),
      issueLastSeenAt: issue.issueLastSeenAt?.toISOString() ?? null,
      actionUrl: `/seller-hub/store/${issue.storeItemId}`,
    };
  });

  return NextResponse.json({ issues: issueList, total });
}

function getDefaultIssueMessage(code: string): string {
  const messages: Record<string, string> = {
    CONNECTION_DISCONNECTED: "Reconnect your Wix store to resume syncing",
    MISSING_PHOTOS: "Add at least one photo to publish this listing on Wix",
    PRICE_ZERO: "Set a price greater than $0 to publish on Wix",
    PRODUCT_NOT_FOUND: "This product was deleted from Wix",
    PRODUCT_DELETED: "This product was deleted from Wix",
    PERMISSION_DENIED: "Reconnect Wix to restore permissions",
    CATALOG_VERSION_MISMATCH: "Reconnect Wix to update the catalog version",
    VALIDATION_ERROR: "Check listing details and try again",
    INSUFFICIENT_INVENTORY: "Inventory is lower than expected",
    SYNC_FAILED: "Sync failed but will retry automatically",
  };
  return messages[code] ?? "There's an issue with this listing";
}
