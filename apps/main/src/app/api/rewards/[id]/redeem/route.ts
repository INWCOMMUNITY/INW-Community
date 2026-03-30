import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { attachPaidStoreOrderToRedemption } from "@/lib/reward-redemption-order";
import { z } from "zod";

const REDEEM_ERR = {
  notFound: { status: 404 as const, body: { error: "Reward not found or no longer available" } },
  limit: { status: 400 as const, body: { error: "This reward has been fully redeemed" } },
  points: (have: number, need: number) => ({
    status: 400 as const,
    body: { error: `You need ${need} points. You have ${have}.` },
  }),
};

const shippingSchema = z.object({
  street: z.string().min(1).max(500),
  aptOrSuite: z.string().max(200).optional().or(z.literal("")),
  city: z.string().min(1).max(200),
  state: z.string().min(1).max(120),
  zip: z.string().min(1).max(32),
});

const redeemBodySchema = z.object({
  contactName: z.string().min(1).max(200),
  contactEmail: z.string().email().max(320),
  contactPhone: z.string().min(7).max(40),
  notesToBusiness: z.string().max(2000).optional().or(z.literal("")),
  shippingAddress: shippingSchema.optional(),
});

function isEmptyBodyJson(raw: unknown): boolean {
  if (raw == null) return true;
  if (typeof raw !== "object") return false;
  return Object.keys(raw as object).length === 0;
}

async function readJsonBody(req: NextRequest): Promise<unknown> {
  try {
    const text = await req.text();
    if (!text.trim()) return {};
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id: rewardId } = await params;

  const raw = await readJsonBody(req);
  const parsed = redeemBodySchema.safeParse(raw);
  const legacyEmpty = !parsed.success && isEmptyBodyJson(raw);

  if (!parsed.success && !legacyEmpty) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let parsedBody: z.infer<typeof redeemBodySchema>;
  let legacyShippingPending = false;

  if (parsed.success) {
    parsedBody = parsed.data;
  } else {
    const member = await prisma.member.findUnique({
      where: { id: session.user.id },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
      },
    });
    if (!member) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const contactName = `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || "Member";
    const phone = (member.phone ?? "").trim();
    parsedBody = {
      contactName,
      contactEmail: member.email,
      contactPhone: phone.length >= 7 ? phone : "0000000000",
      notesToBusiness: "",
      shippingAddress: undefined,
    };
  }

  const rewardPreview = await prisma.reward.findFirst({
    where: { id: rewardId, status: "active" },
    select: { needsShipping: true },
  });

  if (legacyEmpty && rewardPreview?.needsShipping) {
    legacyShippingPending = true;
  }

  const notes =
    parsedBody.notesToBusiness && parsedBody.notesToBusiness.trim()
      ? parsedBody.notesToBusiness.trim()
      : null;

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const rewardRow = await tx.reward.findFirst({
          where: { id: rewardId, status: "active" },
          include: { business: { select: { name: true, memberId: true } } },
        });
        if (!rewardRow) {
          throw Object.assign(new Error("NOT_FOUND"), { redeemCode: "NOT_FOUND" as const });
        }
        if (rewardRow.timesRedeemed >= rewardRow.redemptionLimit) {
          throw Object.assign(new Error("LIMIT"), { redeemCode: "LIMIT" as const });
        }

        const memberRow = await tx.member.findUnique({
          where: { id: session.user.id },
          select: { points: true },
        });
        if (!memberRow || memberRow.points < rewardRow.pointsRequired) {
          throw Object.assign(new Error("POINTS"), {
            redeemCode: "POINTS" as const,
            have: memberRow?.points ?? 0,
            need: rewardRow.pointsRequired,
          });
        }

        if (rewardRow.needsShipping && !legacyShippingPending) {
          const addr = parsedBody.shippingAddress;
          if (!addr) {
            throw Object.assign(new Error("SHIPPING_REQUIRED"), { redeemCode: "SHIPPING_REQUIRED" as const });
          }
        }

        const shippingSnapshot =
          rewardRow.needsShipping && !legacyShippingPending && parsedBody.shippingAddress
            ? {
                street: parsedBody.shippingAddress.street.trim(),
                aptOrSuite: parsedBody.shippingAddress.aptOrSuite?.trim() || undefined,
                city: parsedBody.shippingAddress.city.trim(),
                state: parsedBody.shippingAddress.state.trim(),
                zip: parsedBody.shippingAddress.zip.trim(),
              }
            : null;

        await tx.member.update({
          where: { id: session.user.id },
          data: { points: { decrement: rewardRow.pointsRequired } },
        });
        await tx.reward.update({
          where: { id: rewardId },
          data: { timesRedeemed: { increment: 1 } },
        });

        const row = await tx.rewardRedemption.create({
          data: {
            memberId: session.user.id,
            rewardId,
            pointsSpent: rewardRow.pointsRequired,
            contactName: parsedBody.contactName.trim(),
            contactEmail: parsedBody.contactEmail.trim(),
            contactPhone: parsedBody.contactPhone.trim(),
            notesToBusiness: notes,
            ...(shippingSnapshot ? { shippingAddress: shippingSnapshot as object } : {}),
            ...(legacyShippingPending
              ? { fulfillmentStatus: "pending_checkout" as const }
              : {}),
          },
        });

        let storeOrderId: string | null = null;
        if (rewardRow.needsShipping && shippingSnapshot) {
          storeOrderId = await attachPaidStoreOrderToRedemption(tx, {
            redemptionId: row.id,
            buyerId: session.user.id,
            sellerMemberId: rewardRow.business.memberId,
            shippingAddress: shippingSnapshot,
          });
        }

        const after = await tx.reward.findUnique({
          where: { id: rewardId },
          select: { timesRedeemed: true, redemptionLimit: true },
        });
        if (after && after.timesRedeemed >= after.redemptionLimit) {
          await tx.reward.update({
            where: { id: rewardId },
            data: { status: "redeemed_out" },
          });
        }

        return {
          redemptionId: row.id,
          needsShipping: rewardRow.needsShipping,
          storeOrderId,
          legacyShippingPending,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      }
    );

    try {
      const rewardMeta = await prisma.reward.findUnique({
        where: { id: rewardId },
        select: {
          title: true,
          business: { select: { id: true, memberId: true, name: true } },
        },
      });
      const redeemer = await prisma.member.findUnique({
        where: { id: session.user.id },
        select: { firstName: true, lastName: true },
      });
      if (rewardMeta?.business && rewardMeta.business.memberId !== session.user.id) {
        const who =
          [redeemer?.firstName, redeemer?.lastName].filter(Boolean).join(" ").trim() || "Someone";
        const { sendPushNotification } = await import("@/lib/send-push-notification");
        sendPushNotification(rewardMeta.business.memberId, {
          category: "commerce",
          title: "Reward redeemed!",
          body: `${who} redeemed “${rewardMeta.title}” — tap to view details.`,
          data: {
            screen: "business_redeemed_rewards",
            businessId: rewardMeta.business.id,
          },
        }).catch(() => {});
      }
    } catch {
      /* ignore push errors */
    }

    return NextResponse.json({
      ok: true,
      redemptionId: result.redemptionId,
      needsShippingAddress: result.legacyShippingPending,
      needsShippingCheckout: result.legacyShippingPending,
      storeOrderId: result.storeOrderId,
    });
  } catch (e) {
    if (e && typeof e === "object" && "redeemCode" in e) {
      const code = (e as { redeemCode: string; have?: number; need?: number }).redeemCode;
      if (code === "NOT_FOUND") {
        return NextResponse.json(REDEEM_ERR.notFound.body, { status: REDEEM_ERR.notFound.status });
      }
      if (code === "LIMIT") {
        return NextResponse.json(REDEEM_ERR.limit.body, { status: REDEEM_ERR.limit.status });
      }
      if (code === "POINTS") {
        const x = e as unknown as { have?: number; need?: number };
        if (typeof x.have === "number" && typeof x.need === "number") {
          const r = REDEEM_ERR.points(x.have, x.need);
          return NextResponse.json(r.body, { status: r.status });
        }
      }
      if (code === "SHIPPING_REQUIRED") {
        return NextResponse.json(
          { error: "Shipping address is required for this reward." },
          { status: 400 }
        );
      }
    }
    if (e && typeof e === "object" && "message" in e && (e as Error).message === "INVALID_ADDRESS") {
      return NextResponse.json({ error: "Invalid shipping address." }, { status: 400 });
    }
    if (
      e &&
      typeof e === "object" &&
      "code" in e &&
      (e as { code: string }).code === "P2034"
    ) {
      return NextResponse.json(
        {
          error:
            "Could not complete redemption because another request updated this reward. Please try again.",
        },
        { status: 409 }
      );
    }
    console.error("[rewards/redeem]", e);
    return NextResponse.json({ error: "Failed to redeem" }, { status: 500 });
  }
}
