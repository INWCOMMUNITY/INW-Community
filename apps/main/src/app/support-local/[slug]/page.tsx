import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { prisma } from "database";
import Link from "next/link";
import Image from "next/image";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ShareButton } from "@/components/ShareButton";
import { BusinessPhotoGallery } from "@/components/BusinessPhotoGallery";
import { BusinessCouponsList } from "@/components/BusinessCouponsList";
import { authOptions } from "@/lib/auth";

function isCuid(s: string): boolean {
  return /^c[a-z0-9]{24}$/i.test(s);
}

export default async function BusinessDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const business = await prisma.business.findFirst({
    where: isCuid(slug) ? { id: slug } : { slug },
    include: { coupons: true },
  });
  if (!business) notFound();

  const session = await getServerSession(authOptions);
  const saved = session?.user?.id
    ? await prisma.savedItem.findUnique({
        where: {
          memberId_type_referenceId: {
            memberId: session.user.id,
            type: "business",
            referenceId: business.id,
          },
        },
      })
    : null;

  const addressDisplay = [business.address, business.city].filter(Boolean).join(", ");
  const googleMapsUrl = addressDisplay
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressDisplay)}`
    : null;
  const appleMapsUrl = addressDisplay
    ? `https://maps.apple.com/?q=${encodeURIComponent(addressDisplay)}`
    : null;

  const hours = business.hoursOfOperation as Record<string, string> | null | undefined;
  const hasHours = hours && typeof hours === "object" && Object.keys(hours).length > 0;
  const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

  return (
    <section
      className="py-12 px-4 min-h-screen"
      style={{ padding: "var(--section-padding)", backgroundColor: "#f8e7c9" }}
    >
      <div className="max-w-[2040px] mx-auto">
        {/* Header section - name, location, logo - separate box */}
        <div className="rounded-lg overflow-hidden mb-8 max-w-[1306px] mx-auto border-2 bg-white p-8 md:p-10 relative" style={{ borderColor: "var(--color-primary)" }}>
          {/* Plan: Share and Save above business title, small gap between buttons */}
          <div className="flex justify-end gap-3 mb-4">
            <ShareButton type="business" id={business.id} slug={business.slug} title={business.name} className="p-2 rounded border border-gray-300 bg-white hover:bg-gray-50" />
            <HeartSaveButton type="business" referenceId={business.id} initialSaved={!!saved} />
          </div>
          <div className="text-center">
            <h1
              className="text-2xl md:text-4xl font-bold mb-2"
              style={{ fontFamily: "var(--font-heading)", color: "#000" }}
            >
              {business.name}
            </h1>
            {addressDisplay && (
              <p className="text-base mb-6 opacity-80" style={{ color: "#000" }}>
                {addressDisplay}
              </p>
            )}
            {/* Logo: 1:1 square, large */}
            {business.logoUrl ? (
              <div className="relative aspect-square w-[288px] h-[288px] sm:w-[336px] sm:h-[336px] mx-auto overflow-hidden rounded-none">
                <Image
                  src={business.logoUrl}
                  alt={business.name}
                  fill
                  sizes="(min-width: 640px) 336px, 288px"
                  className="object-cover"
                  priority
                  quality={95}
                  unoptimized={business.logoUrl.startsWith("blob:")}
                />
              </div>
            ) : (
              <div
                className="aspect-square w-[288px] h-[288px] sm:w-[336px] sm:h-[336px] mx-auto rounded-none flex items-center justify-center text-base opacity-60 bg-white border-2"
                style={{ borderColor: "var(--color-primary)", color: "#000" }}
              >
                Logo
              </div>
            )}
          </div>
        </div>

        {/* Business information section - separate box */}
        <div className="rounded-lg overflow-hidden mb-8 max-w-[1306px] mx-auto border-2 bg-white p-6 md:p-8" style={{ borderColor: "var(--color-primary)" }}>
          <div className="grid md:grid-cols-[1fr_1.5fr] gap-8">
            {/* Left column: Hours, Contact, Location, Return button */}
            <div>
              <div className="mb-6">
                <h2 className="text-lg font-bold mb-2" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                  Hours of Operation
                </h2>
                {hasHours ? (
                  <ul className="space-y-1 text-base" style={{ color: "#000" }}>
                    {dayOrder.map((day) => {
                      const val = hours[day];
                      if (!val) return null;
                      return (
                        <li key={day} className="flex gap-3">
                          <span className="capitalize w-20 shrink-0">{day}</span>
                          <span>{val}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-base opacity-80" style={{ color: "#000" }}>
                    Not specified
                  </p>
                )}
              </div>
              <div className="mb-6">
                <h2 className="text-lg font-bold mb-2" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                  Contact
                </h2>
                <ul className="space-y-1 text-base" style={{ color: "#000" }}>
                  {business.phone && <li>Phone: {business.phone}</li>}
                  {business.email && <li>Email: {business.email}</li>}
                  {business.website && (
                    <li>
                      <a
                        href={business.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:underline text-black"
                      >
                        {business.website}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
              {addressDisplay && (
                <div className="mb-6">
                  <h2 className="text-lg font-bold mb-2" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                    Business Location
                  </h2>
                  <p className="text-base" style={{ color: "#000" }}>
                    <a
                      href={googleMapsUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-black"
                    >
                      {addressDisplay}
                    </a>
                  </p>
                </div>
              )}
              <Link href="/support-local" className="btn inline-block">
                Return to Local Business Directory!
              </Link>
            </div>
            {/* Right column: About */}
            <div>
              {business.shortDescription && (
                <p
                  className="text-base mb-4 max-w-xl"
                  style={{ color: "#000", fontFamily: "var(--font-body)" }}
                >
                  {business.shortDescription}
                </p>
              )}
              {business.fullDescription && (
                <div>
                  <h2 className="text-lg font-bold mb-2" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                    About
                  </h2>
                  <p
                    className="whitespace-pre-wrap text-base"
                    style={{ color: "#000", fontFamily: "var(--font-body)" }}
                  >
                    {business.fullDescription}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Gallery section - white with green border */}
        {business.photos?.length > 0 && (
          <div className="mb-8 max-w-[1306px] mx-auto">
            <div
              className="rounded-lg overflow-hidden p-6 border-2 bg-white"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                Gallery
              </h2>
              <BusinessPhotoGallery photos={business.photos} alt={business.name} size="large" />
            </div>
          </div>
        )}

        {/* Coupons - centered */}
        {business.coupons.length > 0 && (
          <div className="max-w-[1306px] mx-auto">
            <div
              className="rounded-lg overflow-hidden p-6 border-2 bg-white flex flex-col items-center"
              style={{ borderColor: "var(--color-primary)" }}
            >
              <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                Coupons
              </h2>
              <BusinessCouponsList
                coupons={business.coupons.map((c) => ({ id: c.id, name: c.name, discount: c.discount }))}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
