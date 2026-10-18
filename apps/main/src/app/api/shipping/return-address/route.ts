import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { getSellerFromAddress, getSellerShippoCredential } from "@/lib/shippo-seller";

export const dynamic = "force-dynamic";

/** Seller Shippo address-book "from" address — destination on a return label. */
export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const cred = await getSellerShippoCredential(userId);
  if (!cred) {
    return NextResponse.json({ error: "Shippo is not connected." }, { status: 400 });
  }
  const from = await getSellerFromAddress(cred);
  if (!from) {
    return NextResponse.json(
      { error: "Add a default ship-from address in your Shippo address book first." },
      { status: 400 }
    );
  }
  const member = await prisma.member.findUnique({
    where: { id: userId },
    select: { phone: true },
  });
  const phone = from.phone?.trim() || member?.phone?.trim() || undefined;
  return NextResponse.json({
    name: from.name,
    company: from.company,
    street1: from.street1,
    street2: from.street2,
    city: from.city,
    state: from.state,
    zip: from.zip,
    country: from.country || "US",
    ...(phone ? { phone: phone.slice(0, 32) } : {}),
    email: from.email,
  });
}
