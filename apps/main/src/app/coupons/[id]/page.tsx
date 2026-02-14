import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
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
  const hasAccess = session?.user?.id
    ? await prisma.subscription.findFirst({
        where: {
          memberId: session.user.id,
          plan: { in: ["subscribe", "sponsor", "seller"] },
          status: "active",
        },
      })
    : null;

  const saved = session?.user?.id
    ? await prisma.savedItem.findUnique({
        where: {
          memberId_type_referenceId: {
            memberId: session.user.id,
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
            <p className="font-medium mb-2">Subscribe to view this coupon</p>
            <p className="text-sm text-gray-600 mb-4">
              Coupon codes are available to Northwest Community subscribers. Subscribe to access the full coupon book.
            </p>
            <Link href="/support-nwc" className="btn">Subscribe to NWC</Link>
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
