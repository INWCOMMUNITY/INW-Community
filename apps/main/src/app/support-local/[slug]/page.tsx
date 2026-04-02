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
import { photosExcludingLogo } from "@/lib/business-photos";
import { extractBusinessDisplayCity } from "@/lib/city-utils";

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

  const cityLine = extractBusinessDisplayCity(business.city) ?? business.city ?? "";
  const addressDisplay = [business.address, cityLine].filter(Boolean).join(", ");
  const googleMapsUrl = addressDisplay
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressDisplay)}`
    : null;
  const hours = business.hoursOfOperation as Record<string, string> | null | undefined;
  const hasHours = hours && typeof hours === "object" && Object.keys(hours).length > 0;
  const dayOrder = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const galleryPhotos = photosExcludingLogo(business.photos ?? [], business.logoUrl);

  return (
    <section className="min-h-screen overflow-x-hidden bg-white pb-12 pt-0 lg:bg-[#f8e7c9] lg:px-4 lg:py-12">
      <nav
        className="lg:hidden sticky top-[var(--site-header-height)] z-30 flex items-center gap-2 px-3 py-3 border-b-2 border-black bg-[var(--color-primary)] text-white"
        aria-label="Business"
      >
        <Link
          href="/support-local"
          className="shrink-0 rounded-lg px-2 py-1.5 font-semibold text-white hover:bg-white/10"
          aria-label="Back to Local Business Directory"
        >
          ←
        </Link>
        <span className="flex-1 text-center font-semibold truncate pr-2 text-base">{business.name}</span>
      </nav>

      <div className="mx-auto w-full min-w-0 max-w-[2040px] px-4 pt-4 pb-12 lg:px-0 lg:pb-12 lg:pt-12">
        {/* Header section - name, location, logo - separate box */}
        <div className="relative mx-auto mb-6 max-w-[1306px] min-w-0 overflow-hidden rounded-lg border-2 border-black bg-white p-4 sm:p-6 md:p-10 lg:mb-8 lg:border-[var(--color-primary)]">
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
              <p className="text-base mb-4 lg:mb-6 opacity-80" style={{ color: "#000" }}>
                {addressDisplay}
              </p>
            )}
            {/* Logo: app size ~220px on mobile */}
            {business.logoUrl ? (
              <div className="relative aspect-square w-[220px] h-[220px] sm:w-[260px] sm:h-[260px] lg:w-[288px] lg:h-[288px] xl:w-[336px] xl:h-[336px] mx-auto overflow-hidden rounded-xl lg:rounded-none">
                <Image
                  src={business.logoUrl}
                  alt={business.name}
                  fill
                  sizes="(min-width: 640px) 672px, 576px"
                  className="object-cover"
                  priority
                  quality={95}
                  unoptimized={business.logoUrl.startsWith("blob:")}
                />
              </div>
            ) : (
              <div
                className="aspect-square w-[220px] h-[220px] sm:w-[260px] sm:h-[260px] lg:w-[288px] lg:h-[288px] xl:w-[336px] xl:h-[336px] mx-auto rounded-xl lg:rounded-none flex items-center justify-center text-base opacity-60 bg-white border-2"
                style={{ borderColor: "var(--color-primary)", color: "#000" }}
              >
                Logo
              </div>
            )}
          </div>
        </div>

        {/* Business information: mobile = primary green panel (fits viewport); lg+ = white 2-col card */}
        <div className="mx-auto mb-6 max-w-[1306px] min-w-0 overflow-hidden rounded-lg border-2 border-black lg:mb-8 lg:border-[var(--color-primary)]">
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1fr_1.5fr] lg:gap-8 lg:bg-white lg:p-8">
            {/* Hours, contact, location, CTAs */}
            <div className="min-w-0 max-w-full break-words bg-[var(--color-primary)] px-4 py-5 text-white lg:bg-transparent lg:px-0 lg:py-0 lg:text-[var(--color-text)]">
              <div className="mb-6">
                <h2
                  className="mb-2 text-lg font-bold !text-white lg:!text-[var(--color-heading)]"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Hours of Operation
                </h2>
                {hasHours ? (
                  <ul className="space-y-1 text-base text-white/95 lg:text-[var(--color-text)]">
                    {dayOrder.map((day) => {
                      const val = hours[day];
                      if (!val) return null;
                      return (
                        <li key={day} className="flex gap-3">
                          <span className="w-20 shrink-0 capitalize">{day}</span>
                          <span className="min-w-0 break-words">{val}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-base text-white/80 lg:text-[var(--color-text)] lg:opacity-80">Not specified</p>
                )}
              </div>
              <div className="mb-6">
                <h2
                  className="mb-2 text-lg font-bold !text-white lg:!text-[var(--color-heading)]"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  Contact
                </h2>
                <ul className="space-y-2 text-base text-white/95 lg:text-[var(--color-text)]">
                  {business.phone && (
                    <li className="break-words">
                      <span className="text-white/80 lg:text-[var(--color-text)] lg:opacity-80">Phone: </span>
                      <a href={`tel:${business.phone.replace(/\s/g, "")}`} className="text-white underline hover:opacity-90 lg:text-[var(--color-link)] lg:no-underline">
                        {business.phone}
                      </a>
                    </li>
                  )}
                  {business.email && (
                    <li className="break-all [overflow-wrap:anywhere]">
                      <span className="text-white/80 lg:text-[var(--color-text)] lg:opacity-80">Email: </span>
                      <a
                        href={`mailto:${business.email}`}
                        className="text-white underline hover:opacity-90 lg:text-[var(--color-link)]"
                      >
                        {business.email}
                      </a>
                    </li>
                  )}
                  {business.website && (
                    <li className="break-all [overflow-wrap:anywhere]">
                      <a
                        href={
                          business.website.startsWith("http://") || business.website.startsWith("https://")
                            ? business.website
                            : `https://${business.website}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-white underline hover:opacity-90 lg:text-[var(--color-link)]"
                      >
                        {business.website}
                      </a>
                    </li>
                  )}
                </ul>
              </div>
              {addressDisplay && (
                <div className="mb-6">
                  <h2
                    className="mb-2 text-lg font-bold !text-white lg:!text-[var(--color-heading)]"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    Business Location
                  </h2>
                  <p className="min-w-0 break-words text-base text-white/95 lg:text-[var(--color-text)]">
                    <a
                      href={googleMapsUrl ?? "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white underline hover:opacity-90 lg:text-[var(--color-link)]"
                    >
                      {addressDisplay}
                    </a>
                  </p>
                </div>
              )}
              {addressDisplay && googleMapsUrl && (
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mb-4 flex w-full min-w-0 items-center justify-center gap-2 rounded-lg border-2 border-black bg-white px-3 py-3 text-center text-base font-semibold text-[var(--color-primary)] lg:hidden"
                >
                  Open in Maps
                </a>
              )}
              <Link
                href="/support-local"
                className="btn inline-block max-lg:!flex max-lg:w-full max-lg:min-w-0 max-lg:max-w-full max-lg:justify-center max-lg:break-words max-lg:!rounded-lg max-lg:!border-2 max-lg:!border-white max-lg:!bg-transparent max-lg:!text-white max-lg:hover:!bg-white/10 max-lg:hover:!text-white"
              >
                Return to Local Business Directory!
              </Link>
            </div>
            {/* About */}
            <div className="min-w-0 max-w-full break-words border-t-2 border-black bg-white px-4 py-5 lg:border-t-0 lg:px-0 lg:py-0">
              {business.shortDescription && (
                <p className="mb-4 text-base [overflow-wrap:anywhere]" style={{ color: "#000", fontFamily: "var(--font-body)" }}>
                  {business.shortDescription}
                </p>
              )}
              {business.fullDescription && (
                <div>
                  <h2 className="text-lg font-bold mb-2" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                    About
                  </h2>
                  <p
                    className="whitespace-pre-wrap text-base [overflow-wrap:anywhere]"
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
        {galleryPhotos.length > 0 && (
          <div className="mx-auto mb-6 min-w-0 max-w-[1306px] lg:mb-8">
            <div className="overflow-hidden rounded-lg border-2 border-black bg-white p-4 md:p-6 lg:border-[var(--color-primary)]">
              <h2 className="text-lg font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "#000" }}>
                Gallery
              </h2>
              <BusinessPhotoGallery photos={galleryPhotos} alt={business.name} size="large" />
            </div>
          </div>
        )}

        {/* Coupons - centered */}
        {business.coupons.length > 0 && (
          <div className="mx-auto min-w-0 max-w-[1306px]">
            <div className="flex flex-col items-center overflow-hidden rounded-lg border-2 border-black bg-white p-4 md:p-6 lg:border-[var(--color-primary)]">
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
