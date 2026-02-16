import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import Link from "next/link";
import Image from "next/image";
import { ShareButton } from "@/components/ShareButton";
import { authOptions } from "@/lib/auth";
import { FollowBusinessButton } from "./FollowBusinessButton";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export default async function SellerStorefrontPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await prisma.business.findFirst({
    where: isCuid(slug) ? { id: slug } : { slug },
    include: {
      member: { select: { id: true, firstName: true, lastName: true } },
      storeItems: {
        where: { status: "active", quantity: { gt: 0 } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!business) notFound();

  const sellerSub = await prisma.subscription.findFirst({
    where: { memberId: business.memberId, plan: "seller", status: "active" },
  });
  if (!sellerSub) notFound();

  const session = await getServerSession(authOptions);

  const addressDisplay = [business.address, business.city].filter(Boolean).join(", ");
  const googleMapsUrl = addressDisplay
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressDisplay)}`
    : null;

  return (
    <section
      className="py-12 px-4 min-h-screen"
      style={{ padding: "var(--section-padding)", backgroundColor: "#f8e7c9" }}
    >
      <div className="max-w-[2040px] mx-auto">
        {/* Cover + Logo header - Facebook-style */}
        <div className="rounded-lg overflow-hidden mb-8 max-w-[1306px] mx-auto border-2" style={{ borderColor: "var(--color-primary)" }}>
          <div className="relative aspect-[2.62] min-h-[200px] bg-gray-200">
            {business.coverPhotoUrl ? (
              <Image
                src={business.coverPhotoUrl}
                alt=""
                fill
                className="object-cover"
                priority
                unoptimized={business.coverPhotoUrl.startsWith("blob:")}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center opacity-40">
                <span className="text-4xl">Store</span>
              </div>
            )}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-1/2">
              <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-lg overflow-hidden border-2 border-[var(--color-primary)] bg-white">
                {business.logoUrl ? (
                  <Image
                    src={business.logoUrl}
                    alt={business.name}
                    width={128}
                    height={128}
                    className="w-full h-full object-cover"
                    unoptimized={business.logoUrl.startsWith("blob:")}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                    Logo
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="bg-white pt-16 pb-6 px-6 text-center">
            <div className="flex justify-center gap-3 mb-2">
              <ShareButton
                type="business"
                id={business.id}
                slug={business.slug}
                title={business.name}
                className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-50"
              />
              {session?.user && <FollowBusinessButton businessId={business.id} />}
            </div>
            <h1
              className="text-2xl md:text-4xl font-bold mb-2"
              style={{ fontFamily: "var(--font-heading)", color: "#000" }}
            >
              {business.name}
            </h1>
            {business.shortDescription && (
              <p className="text-base max-w-2xl mx-auto opacity-90" style={{ color: "#000" }}>
                {business.shortDescription}
              </p>
            )}
          </div>
        </div>

        {/* Contact + Products */}
        <div className="rounded-lg overflow-hidden mb-8 max-w-[1306px] mx-auto border-2 bg-white p-6 md:p-8" style={{ borderColor: "var(--color-primary)" }}>
          <div className="grid md:grid-cols-[1fr_2fr] gap-8">
            <div>
              <h2 className="text-lg font-bold mb-3" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                Contact
              </h2>
              <ul className="space-y-2 text-base" style={{ color: "#000" }}>
                {addressDisplay && <li>{addressDisplay}</li>}
                {business.phone && <li>Phone: {business.phone}</li>}
                {business.email && <li>Email: {business.email}</li>}
                {business.website && (
                  <li>
                    <a
                      href={business.website.startsWith("http") ? business.website : `https://${business.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      style={{ color: "var(--color-link)" }}
                    >
                      {business.website}
                    </a>
                  </li>
                )}
              </ul>
              {addressDisplay && googleMapsUrl && (
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn mt-4 inline-block"
                >
                  Get Directions
                </a>
              )}
              <Link href="/support-local" className="btn mt-4 ml-2 inline-block border border-gray-300 bg-white hover:bg-gray-50">
                Back to Sellers
              </Link>
            </div>
            <div>
              <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                Products ({business.storeItems.length})
              </h2>
              {business.storeItems.length === 0 ? (
                <p className="text-gray-600">No products listed yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {business.storeItems.map((item) => {
                    const basePath = item.listingType === "resale" ? "/resale" : "/storefront";
                    return (
                    <Link
                      key={item.id}
                      href={`${basePath}/${item.slug}`}
                      className="border-2 rounded-lg overflow-hidden hover:opacity-90 transition"
                      style={{ borderColor: "var(--color-primary)" }}
                    >
                      <div className="aspect-square relative bg-gray-100">
                        {item.photos?.[0] ? (
                          <Image
                            src={item.photos[0]}
                            alt={item.title}
                            fill
                            className="object-cover"
                            unoptimized={item.photos[0].startsWith("blob:")}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="p-3">
                        <h3 className="font-semibold text-sm line-clamp-2">{item.title}</h3>
                        <p className="text-sm font-bold mt-1">${(item.priceCents / 100).toFixed(2)}</p>
                      </div>
                    </Link>
                  );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
