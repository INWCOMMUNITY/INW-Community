"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";
import { HeartSaveButton } from "@/components/HeartSaveButton";
import { ShareButton } from "@/components/ShareButton";
import { BusinessHorizontalGallery } from "@/components/business/BusinessHorizontalGallery";
import { BusinessCouponCards, type BusinessCouponItem } from "@/components/business/BusinessCouponCards";
import { BusinessCommunityFeed } from "@/components/business/BusinessCommunityFeed";
import {
  BUSINESS_PAGE_SHELL,
  BUSINESS_SECTION_STACK,
  BUSINESS_SECTION_TITLE,
} from "@/components/business/business-page-layout";

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export type BusinessDetailData = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  fullDescription: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  addressDisplay: string;
  googleMapsUrl: string | null;
  hoursOfOperation: Record<string, string> | null;
  galleryPhotos: string[];
  coupons: BusinessCouponItem[];
};

function formatWebsiteHref(url: string): string {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
}

export function BusinessDetailContent({
  business,
  initialSaved,
  backHref = "/support-local",
}: {
  business: BusinessDetailData;
  initialSaved: boolean;
  backHref?: string;
}) {
  const { data: session } = useSession();
  const [savedNote, setSavedNote] = useState(false);

  const hours = business.hoursOfOperation;
  const hasHours = hours && typeof hours === "object" && Object.keys(hours).length > 0;

  return (
    <div className="bg-white min-h-[50vh]">
      {savedNote ? (
        <div
          className="fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 max-w-[90vw] px-4 py-3 rounded-lg border-2 border-[var(--color-primary)] shadow-lg text-sm font-semibold text-center"
          style={{ backgroundColor: "#FFF8E1", color: "var(--color-heading)" }}
          role="status"
        >
          {business.name} saved to My Businesses!
        </div>
      ) : null}

      <div className={BUSINESS_PAGE_SHELL}>
        <div
          className="flex items-center gap-2 py-2 rounded-lg border-b-2 border-black mt-1"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <Link
            href={backHref}
            className="p-1.5 text-white hover:opacity-90 shrink-0"
            aria-label="Back to directory"
          >
            <IonIcon name="arrow-back" size={22} className="text-white" />
          </Link>
          <span
            className="flex-1 text-base font-bold text-white text-center truncate px-2"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {business.name}
          </span>
          <span className="w-9 shrink-0" aria-hidden />
        </div>

        {session?.user ? (
          <div className="flex items-center justify-end gap-1 py-2">
            <HeartSaveButton
              type="business"
              referenceId={business.id}
              initialSaved={initialSaved}
              showWishlistToast={false}
              className="!w-10 !h-10"
              onSavedChange={(saved) => {
                if (saved) {
                  setSavedNote(true);
                  window.setTimeout(() => setSavedNote(false), 3000);
                }
              }}
            />
            <ShareButton
              type="business"
              id={business.id}
              slug={business.slug}
              title={business.name}
              className="!p-2 !border-0 !bg-transparent hover:!bg-black/5"
            />
          </div>
        ) : null}

        <div className={`${BUSINESS_SECTION_STACK} pb-6`}>
          <div className="pt-2 text-center">
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
            >
              {business.name}
            </h1>
            {business.addressDisplay && business.googleMapsUrl ? (
              <a
                href={business.googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1.5 mt-2 max-w-full text-sm hover:opacity-90"
                style={{ color: "var(--color-text)" }}
              >
                <IonIcon name="location" size={18} className="text-[var(--color-primary)] shrink-0" />
                <span className="text-center leading-snug">{business.addressDisplay}</span>
                <IonIcon name="open-outline" size={14} className="text-[var(--color-primary)] shrink-0" />
              </a>
            ) : business.addressDisplay ? (
              <p className="mt-2 text-sm text-center" style={{ color: "var(--color-text)" }}>
                {business.addressDisplay}
              </p>
            ) : null}
          </div>

          <div className="flex justify-center py-3">
            {business.logoUrl ? (
              <div className="relative w-[220px] h-[220px] rounded-xl overflow-hidden bg-[#f5f5f5] shrink-0">
                <Image
                  src={business.logoUrl}
                  alt={business.name}
                  fill
                  className="object-cover"
                  sizes="220px"
                  priority
                  unoptimized={business.logoUrl.startsWith("blob:")}
                />
              </div>
            ) : (
              <div
                className="w-[220px] h-[220px] rounded-xl flex items-center justify-center bg-[#f5f5f5] border-2 border-[var(--color-primary)]"
                aria-hidden
              >
                <IonIcon name="business" size={48} className="text-[var(--color-primary)]" />
              </div>
            )}
          </div>

          {hasHours && hours ? (
            <div>
              <p className={BUSINESS_SECTION_TITLE} style={{ color: "var(--color-heading)" }}>
                Hours of Operation
              </p>
              <ul className="space-y-1">
                {DAY_ORDER.map((day) => {
                  const val = hours[day];
                  if (!val) return null;
                  return (
                    <li key={day} className="flex gap-3 text-sm" style={{ color: "var(--color-text)" }}>
                      <span className="w-[5.5rem] shrink-0 capitalize">{day}</span>
                      <span className="min-w-0 break-words">{val}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {(business.phone || business.email || business.website) ? (
            <div>
              <p className={BUSINESS_SECTION_TITLE} style={{ color: "var(--color-heading)" }}>
                Contact
              </p>
              <ul className="space-y-2">
                {business.phone ? (
                  <li>
                    <a
                      href={`tel:${business.phone.replace(/\s/g, "")}`}
                      className="flex items-center gap-2 text-sm font-medium hover:opacity-90"
                      style={{ color: "var(--color-primary)" }}
                    >
                      <IonIcon name="call" size={18} />
                      {business.phone}
                    </a>
                  </li>
                ) : null}
                {business.email ? (
                  <li>
                    <a
                      href={`mailto:${business.email}`}
                      className="flex items-center gap-2 text-sm font-medium hover:opacity-90 break-all"
                      style={{ color: "var(--color-primary)" }}
                    >
                      <IonIcon name="mail" size={18} className="shrink-0" />
                      {business.email}
                    </a>
                  </li>
                ) : null}
                {business.website ? (
                  <li>
                    <a
                      href={formatWebsiteHref(business.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm font-medium hover:opacity-90 break-all"
                      style={{ color: "var(--color-primary)" }}
                    >
                      <IonIcon name="globe" size={18} className="shrink-0" />
                      {business.website}
                    </a>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {business.googleMapsUrl ? (
            <a
              href={business.googleMapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 border-black text-white font-semibold hover:opacity-90"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              <IonIcon name="map" size={18} className="text-white" />
              Open in Maps
            </a>
          ) : null}

          {business.shortDescription ? (
            <div>
              <p className={BUSINESS_SECTION_TITLE} style={{ color: "var(--color-heading)" }}>
                About
              </p>
              <p className="text-[15px] leading-snug whitespace-pre-wrap" style={{ color: "var(--color-text)" }}>
                {business.shortDescription}
              </p>
            </div>
          ) : null}

          {business.fullDescription ? (
            <div>
              {!business.shortDescription ? (
                <p className={BUSINESS_SECTION_TITLE} style={{ color: "var(--color-heading)" }}>
                  About
                </p>
              ) : null}
              <p className="text-[15px] leading-snug whitespace-pre-wrap" style={{ color: "var(--color-text)" }}>
                {business.fullDescription}
              </p>
            </div>
          ) : null}

          {business.galleryPhotos.length > 0 ? (
            <div>
              <p className={BUSINESS_SECTION_TITLE} style={{ color: "var(--color-heading)" }}>
                Gallery
              </p>
              <BusinessHorizontalGallery photos={business.galleryPhotos} alt={business.name} />
            </div>
          ) : null}

          {business.coupons.length > 0 ? (
            <div>
              <p className={BUSINESS_SECTION_TITLE} style={{ color: "var(--color-heading)" }}>
                Coupons
              </p>
              <BusinessCouponCards coupons={business.coupons} />
            </div>
          ) : null}

          <BusinessCommunityFeed businessId={business.id} />
        </div>
      </div>
    </div>
  );
}
