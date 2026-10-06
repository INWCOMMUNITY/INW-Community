import { NextRequest, NextResponse } from "next/server";
import { getActiveWixConnectionForMember, prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import {
  listWixImportCandidates,
  WixImportDiscoveryError,
} from "@/lib/wix/import-discovery";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const connection = await getActiveWixConnectionForMember(prisma, memberId);
  if (!connection) {
    return NextResponse.json(
      { error: "No active Wix connection", code: "CONNECTION_REQUIRED" },
      { status: 404 }
    );
  }

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const limitStr = req.nextUrl.searchParams.get("limit");
  const limit = limitStr ? parseInt(limitStr, 10) : 50;
  const includeHidden = req.nextUrl.searchParams.get("includeHidden") === "true";

  try {
    const result = await listWixImportCandidates(connection, {
      limit: Math.min(Math.max(1, limit), 100),
      cursor,
      includeHidden,
    });

    return NextResponse.json({
      candidates: result.candidates,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    console.error("WIX_IMPORT_CANDIDATES_ERROR", {
      error: error instanceof Error ? error.message : "Unknown error",
      code: error instanceof WixImportDiscoveryError ? error.code : undefined,
      connectionId: connection.id,
      catalogVersion: connection.catalogVersion,
    });
    if (error instanceof WixImportDiscoveryError) {
      const status =
        error.code === "PERMISSION" || error.code === "TOKEN"
          ? 403
          : error.code === "NOT_CONFIGURED"
            ? 503
            : error.code === "TRANSIENT"
              ? 502
              : 500;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    return NextResponse.json(
      { error: "Could not fetch Wix products", code: "UNKNOWN" },
      { status: 500 }
    );
  }
}
