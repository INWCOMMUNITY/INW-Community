import { waitUntil } from "@vercel/functions";
import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";
import { memberHasStorefrontListingAccess } from "@/lib/storefront-seller-access";
import {
  runEtsyListingAction,
  type EtsyListingAction,
} from "@/lib/etsy/listing-actions";
import { runNextEtsySyncJob } from "@/lib/etsy/worker";

export const dynamic = "force-dynamic";

const ACTIONS = new Set<EtsyListingAction>(["retry", "remove", "reload"]);

function kickEtsySyncJobs() {
  waitUntil(
    (async () => {
      for (let i = 0; i < 16; i += 1) {
        const ran = await runNextEtsySyncJob({ workerId: `etsy-action-inline-${i}` });
        if (!ran.claimed) break;
      }
    })()
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getSessionForApi(req);
    const memberId = session?.user?.id;
    if (!memberId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await memberHasStorefrontListingAccess(memberId))) {
      return NextResponse.json({ error: "Seller access required" }, { status: 403 });
    }

    const resolved = await Promise.resolve(params);
    const storeItemId = typeof resolved?.id === "string" ? resolved.id.trim() : "";
    if (!storeItemId) {
      return NextResponse.json({ error: "storeItemId is required" }, { status: 400 });
    }

    let action: EtsyListingAction | "" = "";
    let confirmDelete = false;
    try {
      const body = (await req.json()) as { action?: unknown; confirmDelete?: unknown };
      action = typeof body.action === "string" ? (body.action as EtsyListingAction) : "";
      confirmDelete = body.confirmDelete === true;
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (!ACTIONS.has(action as EtsyListingAction)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    const result = await runEtsyListingAction({
      memberId,
      storeItemId,
      action: action as EtsyListingAction,
      confirmDelete,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code },
        { status: result.status }
      );
    }
    if (action === "reload" || action === "retry") {
      kickEtsySyncJobs();
    }
    return NextResponse.json({ ok: true, message: result.message ?? null });
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Could not process Etsy listing action";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
