import { NextRequest, NextResponse } from "next/server";
import { getActiveWixConnectionForMember, prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import { importWixProduct } from "@/lib/wix/import-listing";

export const dynamic = "force-dynamic";

type ImportRequestBody = {
  wixProductId: string;
  stockMode?: "PHYSICAL" | "MADE_TO_ORDER";
};

type ImportManyRequestBody = {
  products: Array<{
    wixProductId: string;
    stockMode?: "PHYSICAL" | "MADE_TO_ORDER";
  }>;
};

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  const memberId = session?.user?.id;
  if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await memberHasStorefrontListingAccess(memberId))) {
    return NextResponse.json({ error: "Seller access required" }, { status: 403 });
  }

  const connection = await getActiveWixConnectionForMember(prisma, memberId);
  if (!connection) {
    return NextResponse.json({ error: "No active Wix connection" }, { status: 404 });
  }

  let body: ImportRequestBody | ImportManyRequestBody;
  try {
    body = (await req.json()) as ImportRequestBody | ImportManyRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Handle single product import
  if ("wixProductId" in body && typeof body.wixProductId === "string") {
    const stockMode = body.stockMode === "MADE_TO_ORDER" ? "MADE_TO_ORDER" : "PHYSICAL";
    
    try {
      const result = await importWixProduct({
        connection,
        wixProductId: body.wixProductId,
        stockMode,
      });

      if (result.status === "IMPORTED") {
        console.info("WIX_PRODUCT_IMPORTED", {
          connectionId: connection.id,
          wixProductId: body.wixProductId,
          storeItemId: result.storeItemId,
          listingLinkId: result.listingLinkId,
        });
        return NextResponse.json({
          status: "imported",
          storeItemId: result.storeItemId,
          listingLinkId: result.listingLinkId,
        });
      }

      if (result.status === "ALREADY_IMPORTED") {
        return NextResponse.json({
          status: "already_imported",
          storeItemId: result.storeItemId,
          listingLinkId: result.listingLinkId,
        });
      }

      if (result.status === "ALREADY_IMPORTING") {
        return NextResponse.json({
          status: "importing",
          attemptId: result.attemptId,
        });
      }

      if (result.status === "PRODUCT_NOT_FOUND") {
        return NextResponse.json({ error: "Product not found on Wix" }, { status: 404 });
      }

      return NextResponse.json(
        { error: result.message || "Import failed" },
        { status: 500 }
      );
    } catch (error) {
      console.error("WIX_IMPORT_ERROR", {
        error: error instanceof Error ? error.message : "Unknown error",
        connectionId: connection.id,
        wixProductId: body.wixProductId,
      });
      return NextResponse.json({ error: "Import failed" }, { status: 500 });
    }
  }

  // Handle batch import
  if ("products" in body && Array.isArray(body.products)) {
    const results: Array<{
      wixProductId: string;
      status: string;
      storeItemId?: string;
      listingLinkId?: string;
      error?: string;
    }> = [];

    for (const product of body.products.slice(0, 20)) {
      if (typeof product.wixProductId !== "string") continue;
      
      const stockMode = product.stockMode === "MADE_TO_ORDER" ? "MADE_TO_ORDER" : "PHYSICAL";
      
      try {
        const result = await importWixProduct({
          connection,
          wixProductId: product.wixProductId,
          stockMode,
        });

        if (result.status === "IMPORTED") {
          results.push({
            wixProductId: product.wixProductId,
            status: "imported",
            storeItemId: result.storeItemId,
            listingLinkId: result.listingLinkId,
          });
        } else if (result.status === "ALREADY_IMPORTED") {
          results.push({
            wixProductId: product.wixProductId,
            status: "already_imported",
            storeItemId: result.storeItemId,
            listingLinkId: result.listingLinkId,
          });
        } else if (result.status === "PRODUCT_NOT_FOUND") {
          results.push({
            wixProductId: product.wixProductId,
            status: "not_found",
            error: "Product not found on Wix",
          });
        } else {
          results.push({
            wixProductId: product.wixProductId,
            status: "failed",
            error: result.status === "FAILED" ? result.message : "Import failed",
          });
        }
      } catch (error) {
        results.push({
          wixProductId: product.wixProductId,
          status: "failed",
          error: error instanceof Error ? error.message : "Import failed",
        });
      }
    }

    const imported = results.filter((r) => r.status === "imported").length;
    console.info("WIX_BATCH_IMPORT_COMPLETED", {
      connectionId: connection.id,
      total: results.length,
      imported,
    });

    return NextResponse.json({ results, imported, total: results.length });
  }

  return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
}
