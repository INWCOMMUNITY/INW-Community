import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { etsyConnectionRequest } from "@/lib/etsy/connection-request";

export const dynamic = "force-dynamic";

type ShippingProfileRow = {
  shipping_profile_id?: number | string;
  title?: string;
  shipping_profile_name?: string;
};

/** List Etsy shipping profiles for the ACTIVE connection (for shop defaults). */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
  });
  if (!connection) {
    return NextResponse.json({ connectionStatus: "DISCONNECTED", profiles: [] });
  }

  const res = await etsyConnectionRequest<{ results?: ShippingProfileRow[] } | ShippingProfileRow[]>({
    connectionId: connection.id,
    memberId,
    method: "GET",
    path: `/shops/${encodeURIComponent(connection.shopId)}/shipping-profiles`,
    maxAttempts: 3,
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: res.message || "Could not load shipping profiles", code: res.class },
      { status: 502 }
    );
  }

  const rows = Array.isArray(res.data)
    ? res.data
    : Array.isArray(res.data?.results)
      ? res.data.results
      : [];

  const profiles = rows
    .map((row) => {
      const id = String(row.shipping_profile_id ?? "").trim();
      if (!/^\d+$/.test(id)) return null;
      return {
        id,
        title: row.title || row.shipping_profile_name || `Profile ${id}`,
      };
    })
    .filter((row): row is { id: string; title: string } => row != null);

  return NextResponse.json({
    connectionStatus: "ACTIVE",
    connectionId: connection.id,
    defaultShippingProfileId: connection.defaultShippingProfileId,
    defaultTaxonomyId: connection.defaultTaxonomyId,
    profiles,
  });
}

/** Persist shop-level Etsy publish defaults. */
export async function PATCH(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  let body: {
    defaultShippingProfileId?: unknown;
    defaultTaxonomyId?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const connection = await prisma.etsyConnection.findFirst({
    where: { memberId, status: "ACTIVE" },
    orderBy: { connectedAt: "desc" },
  });
  if (!connection) {
    return NextResponse.json({ error: "No active Etsy connection" }, { status: 409 });
  }

  const data: {
    defaultShippingProfileId?: string | null;
    defaultTaxonomyId?: number | null;
  } = {};

  if (body.defaultShippingProfileId !== undefined) {
    if (body.defaultShippingProfileId === null || body.defaultShippingProfileId === "") {
      data.defaultShippingProfileId = null;
    } else if (
      typeof body.defaultShippingProfileId === "string" &&
      /^\d+$/.test(body.defaultShippingProfileId.trim())
    ) {
      data.defaultShippingProfileId = body.defaultShippingProfileId.trim();
    } else {
      return NextResponse.json({ error: "Invalid shipping profile id" }, { status: 400 });
    }
  }

  if (body.defaultTaxonomyId !== undefined) {
    if (body.defaultTaxonomyId === null || body.defaultTaxonomyId === "") {
      data.defaultTaxonomyId = null;
    } else if (
      typeof body.defaultTaxonomyId === "number" &&
      Number.isInteger(body.defaultTaxonomyId) &&
      body.defaultTaxonomyId > 0
    ) {
      data.defaultTaxonomyId = body.defaultTaxonomyId;
    } else if (
      typeof body.defaultTaxonomyId === "string" &&
      /^\d+$/.test(body.defaultTaxonomyId.trim())
    ) {
      data.defaultTaxonomyId = Number.parseInt(body.defaultTaxonomyId.trim(), 10);
    } else {
      return NextResponse.json({ error: "Invalid taxonomy id" }, { status: 400 });
    }
  }

  const updated = await prisma.etsyConnection.update({
    where: { id: connection.id },
    data,
    select: {
      id: true,
      defaultShippingProfileId: true,
      defaultTaxonomyId: true,
    },
  });

  return NextResponse.json({ connection: updated });
}
