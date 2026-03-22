import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import { prismaWhereActivePaidNwcPlan } from "@/lib/nwc-paid-subscription";
import Link from "next/link";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ShareButton } from "@/components/ShareButton";

export default async function CouponDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    include: { business: true },
  });
  if (!coupon) notFound();

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const isLoggedIn = Boolean(userId);
  const isOwner = Boolean(userId && coupon.business?.memberId === userId);
  const hasPaidPlan =
    !!userId && !!(await prisma.subscription.findFirst({ where: prismaWhereActivePaidNwcPlan(userId) }));
  const hasAccess = hasPaidPlan || isOwner;

  const saved = userId
    ? await prisma.savedItem.findUnique({
        where: {
          memberId_type_referenceId: {
            memberId: userId,
            type: "coupon",
            referenceId: coupon.id,
          },
        },
      })
    : null;

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <Link href="/coupons" className="text-sm text-gray-600 hover:underline mb-4 inline-block">
          ← Back to Coupon Book
        </Link>
        <h1 className="text-3xl font-bold mb-2">{coupon.name}</h1>
        <p className="text-lg text-gray-600 mb-2">{coupon.discount}</p>
        {coupon.business && (
          <p className="text-gray-600 mb-4">{coupon.business.name}</p>
        )}
        {hasAccess ? (
          <>
            {coupon.imageUrl && (
              <img src={coupon.imageUrl} alt={coupon.name} className="max-w-xs mb-4" />
            )}
            <div className="bg-gray-100 rounded-lg p-4 inline-block">
              <p className="text-sm text-gray-600 mb-1">Coupon code</p>
              <p className="text-xl font-mono font-bold">{coupon.code}</p>
            </div>
          </>
        ) : (
          <div className="border rounded-lg p-6 bg-amber-50 max-w-md">
            <p className="font-medium mb-2">Member plan required</p>
            <p className="text-sm text-gray-600 mb-4">
              Coupon codes are available with an active Northwest Community Subscribe, Business, or Seller plan.{" "}
              {!isLoggedIn ? "Create an account and choose a plan, or log in." : "Choose a plan on Support NWC to unlock the coupon book."}
            </p>
            {!isLoggedIn ? (
              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <Link href="/signup?next=%2Fsupport-nwc" className="btn text-center">
                  Sign up
                </Link>
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent(`/coupons/${coupon.id}`)}`}
                  className="btn text-center border-2 border-[var(--color-primary)] bg-white"
                  style={{ color: "var(--color-primary)" }}
                >
                  Log in
                </Link>
              </div>
            ) : null}
            <Link href="/support-nwc" className="btn inline-block">
              View plans
            </Link>
          </div>
        )}
        <div className="flex gap-3 mt-4">
          <ShareButton type="coupon" id={coupon.id} title={coupon.name} className="btn text-sm" />
          <HeartSaveButton
            type="coupon"
            referenceId={coupon.id}
            initialSaved={!!saved}
          />
        </div>
      </div>
    </section>
  );
}
