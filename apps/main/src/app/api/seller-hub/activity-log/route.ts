import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import {
  formatActivityMessage,
  getActivityIcon,
  getActivityColor,
  type SellerActivityAction,
  type EntityType,
} from "@/lib/seller-activity-log";

export const dynamic = "force-dynamic";

interface ActivityLogEntry {
  id: string;
  action: SellerActivityAction;
  entityType: EntityType;
  entityId: string | null;
  detail: unknown;
  metadata: unknown;
  createdAt: string;
  message: string;
  icon: string;
  color: string;
}

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const action = searchParams.get("action") as SellerActivityAction | null;
  const entityType = searchParams.get("entityType") as EntityType | null;
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  const memberId = session.user.id;

  // Build where clause
  const where: {
    memberId: string;
    action?: string;
    entityType?: string;
    createdAt?: { gte?: Date; lte?: Date; lt?: Date };
  } = { memberId };

  if (action) {
    where.action = action;
  }

  if (entityType) {
    where.entityType = entityType;
  }

  if (startDate || endDate || cursor) {
    where.createdAt = {};
    if (startDate) {
      where.createdAt.gte = new Date(startDate);
    }
    if (endDate) {
      where.createdAt.lte = new Date(endDate);
    }
    if (cursor) {
      where.createdAt.lt = new Date(cursor);
    }
  }

  const logs = await prisma.sellerActivityLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });

  const hasMore = logs.length > limit;
  const items = logs.slice(0, limit);

  const entries: ActivityLogEntry[] = items.map((log) => ({
    id: log.id,
    action: log.action as SellerActivityAction,
    entityType: log.entityType as EntityType,
    entityId: log.entityId,
    detail: log.detail,
    metadata: log.metadata,
    createdAt: log.createdAt.toISOString(),
    message: formatActivityMessage(log.action as SellerActivityAction, log.detail as Record<string, unknown> | null),
    icon: getActivityIcon(log.action as SellerActivityAction),
    color: getActivityColor(log.action as SellerActivityAction),
  }));

  const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null;

  return NextResponse.json({
    items: entries,
    nextCursor,
    hasMore,
  });
}
