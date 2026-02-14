import { getServerSession } from "next-auth";
import { prisma } from "database";
import { authOptions } from "@/lib/auth";
import Link from "next/link";
import { UnsaveButton } from "@/components/UnsaveButton";

export default async function MyFavoriteCouponsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return (
      <p className="text-gray-600">Please sign in to view your favorite coupons.</p>
    );
  }

  const saved = await prisma.savedItem.findMany({
    where: { memberId: session.user.id, type: "coupon" },
    orderBy: { createdAt: "desc" },
  });

  const couponIds = saved.map((s) => s.referenceId).filter(Boolean);
  const coupons =
    couponIds.length > 0
      ? await prisma.coupon.findMany({
          where: { id: { in: couponIds } },
          include: { business: { select: { name: true, slug: true } } },
        })
      : [];

  const couponMap = new Map(coupons.map((c) => [c.id, c]));
  const validSaved = saved.filter((s) => couponMap.has(s.referenceId));

  return (
    <>
      <h1 className="text-2xl font-bold mb-6">My Coupons</h1>
      {validSaved.length === 0 ? (
        <p className="text-gray-600">
          You haven&apos;t saved any coupons yet. Browse the{" "}
          <Link href="/coupons" className="hover:underline" style={{ color: "var(--color-link)" }}>
            coupon book
          </Link>{" "}
          to find coupons to save.
        </p>
      ) : (
        <ul className="space-y-4">
          {validSaved.map((s) => {
            const coupon = couponMap.get(s.referenceId);
            if (!coupon) return null;
            return (
              <li
                key={s.id}
                className="border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  {coupon.imageUrl ? (
                    <img
                      src={coupon.imageUrl}
                      alt=""
                      className="w-16 h-16 object-contain rounded"
                    />
                  ) : null}
                  <div>
                    <Link
                      href={`/coupons/${coupon.id}`}
                      className="font-medium hover:underline"
                      style={{ color: "var(--color-link)" }}
                    >
                      {coupon.name}
                    </Link>
                    <p className="text-sm text-gray-600">
                      {coupon.discount}
                      {coupon.business ? ` · ${coupon.business.name}` : ""}
                    </p>
                  </div>
                </div>
                <UnsaveButton type="coupon" referenceId={coupon.id} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
