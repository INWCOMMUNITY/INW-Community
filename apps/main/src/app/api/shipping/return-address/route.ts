import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

const RETURN_ADDRESS_KEYS = ["street1", "street2", "city", "state", "zip", "company"] as const;
type ReturnAddressPayload = Partial<Record<(typeof RETURN_ADDRESS_KEYS)[number], string>>;

function normalizeReturnAddress(body: unknown): ReturnAddressPayload | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;
  const street1 = typeof o.street1 === "string" ? o.street1.trim() : "";
  const city = typeof o.city === "string" ? o.city.trim() : "";
  const state = typeof o.state === "string" ? o.state.trim() : "";
  const zip = typeof o.zip === "string" ? o.zip.trim().replace(/\D/g, "").slice(0, 10) : "";
  if (!street1 || !city || !state || !zip) return null;
  return {
    street1,
    street2: typeof o.street2 === "string" ? o.street2.trim().slice(0, 64) : undefined,
    city: city.slice(0, 64),
    state: state.slice(0, 32),
    zip,
    company: typeof o.company === "string" ? o.company.trim().slice(0, 64) : undefined,
  };
}

/**
 * GET: Return the seller's EasyPost return address (used only for labels and packing slips).
 */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { easypostReturnAddress: true },
  });
  const addr = member?.easypostReturnAddress as ReturnAddressPayload | null;
  return NextResponse.json(addr ?? null);
}

/**
 * PUT: Set the seller's EasyPost return address. Must match the return address in the seller's EasyPost account.
 * Used only for shipping labels and packing slips; not connected to the app's business address.
 */
export async function PUT(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sub = await prisma.subscription.findFirst({
    where: { memberId: userId, plan: "seller", status: "active" },
  });
  if (!sub) {
    return NextResponse.json({ error: "Seller plan required" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const address = normalizeReturnAddress(body);
  if (!address) {
    return NextResponse.json(
      { error: "Street, city, state, and ZIP are required for the return address." },
      { status: 400 }
    );
  }

  await prisma.member.update({
    where: { id: userId },
    data: { easypostReturnAddress: address as object },
  });

  return NextResponse.json({ ok: true, address });
}
