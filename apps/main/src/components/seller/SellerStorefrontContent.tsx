"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { IonIcon } from "@/components/IonIcon";
import { BusinessHorizontalGallery } from "@/components/business/BusinessHorizontalGallery";
import { FollowBusinessButton } from "@/app/support-local/sellers/[slug]/FollowBusinessButton";
import { ShareButton } from "@/components/ShareButton";
import { StorefrontCard } from "@/components/store/StorefrontCard";
import { buildProductLinkWithReferrer } from "@/lib/product-referrer";
import { buildBusinessHref } from "@/lib/business-referrer";

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export type SellerStoreItem = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  photos: string[];
  category: string | null;
  priceCents: number;
};

export type SellerStorefrontData = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  fullDescription: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  addressDisplay: string;
  googleMapsUrl: string | null;
  hoursOfOperation: Record<string, string> | null;
  galleryPhotos: string[];
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  memberSince: number;
  memberUserId: string;
  acceptMessagesForListings: boolean;
  offerShipping: boolean;
  offerLocalDelivery: boolean;
  offerLocalPickup: boolean;
  sellerShippingPolicy: string | null;
  sellerLocalDeliveryPolicy: string | null;
  sellerPickupPolicy: string | null;
  sellerReturnPolicy: string | null;
  storeItems: SellerStoreItem[];
};

type TabId = "products" | "about" | "policies";

function formatWebsiteHref(url: string): string {
  return url.startsWith("http://") || url.startsWith("https://") ? url : `https://${url}`;
}

const FULFILLMENT_BADGE =
  "inline-flex items-center gap-1.5 rounded-2xl border border-[var(--color-primary)] bg-[var(--color-section-alt)] px-3 py-1.5 text-xs font-medium text-[var(--color-primary)]";

export function SellerStorefrontContent({ seller }: { seller: SellerStorefrontData }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState<TabId>("products");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const [aboutExpanded, setAboutExpanded] = useState(true);
  const hoursSectionRef = useRef<HTMLDivElement>(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageError, setMessageError] = useState("");

  const categories = useMemo(() => {
    const cats = new Set<string>();
    seller.storeItems.forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [seller.storeItems]);

  const filteredItems = useMemo(() => {
    if (!selectedCategory) return seller.storeItems;
    return seller.storeItems.filter((item) => item.category === selectedCategory);
  }, [seller.storeItems, selectedCategory]);

  const hasHours =
    seller.hoursOfOperation && Object.keys(seller.hoursOfOperation).length > 0;
  const hasPolicies =
    seller.sellerShippingPolicy ||
    seller.sellerLocalDeliveryPolicy ||
    seller.sellerPickupPolicy ||
    seller.sellerReturnPolicy;
  const hasSocial = seller.facebookUrl || seller.instagramUrl || seller.tiktokUrl;

  useEffect(() => {
    if (!session?.user) return;
    fetch("/api/saved?type=store_item")
      .then((r) => r.json())
      .then((list: { referenceId: string }[]) => {
        setSavedIds(new Set(list.map((i) => i.referenceId)));
      })
      .catch(() => {});
  }, [session?.user]);

  const sendMessage = async () => {
    if (!messageText.trim() || sendingMessage) return;
    if (!session?.user) {
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setSendingMessage(true);
    setMessageError("");
    try {
      const res = await fetch("/api/direct-conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addresseeId: seller.memberUserId,
          content: messageText.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessageError(typeof data.error === "string" ? data.error : "Could not send message.");
        return;
      }
      setMessageOpen(false);
      setMessageText("");
      if (data.id) {
        router.push(`/my-community/messages?direct=${data.id}`);
      }
    } finally {
      setSendingMessage(false);
    }
  };

  const openMessage = () => {
    if (!session?.user) {
      router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setMessageOpen(true);
  };

  return (
    <div className="min-h-screen bg-white">
      {/* App-style top bar */}
      <div
        className="sticky top-0 z-30 flex items-center gap-2 px-2 pb-3 pt-2 md:px-4"
        style={{ backgroundColor: "var(--color-primary)" }}
      >
        <Link
          href="/support-local/sellers"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center text-white hover:opacity-90"
          aria-label="Back to sellers"
        >
          <IonIcon name="arrow-back" size={24} className="text-white" />
        </Link>
        <h1
          className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold text-white md:text-xl"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {seller.name}
        </h1>
        <div className="w-10 shrink-0 flex justify-end">
          <ShareButton
            type="seller"
            id={seller.id}
            slug={seller.slug}
            title={seller.name}
            className="!w-10 !h-10 !rounded-full !border-0 !bg-transparent hover:!bg-white/10"
            iconClassName="text-white"
            iconSize={22}
          />
        </div>
      </div>

      {/* Cover + logo: same width as Products–Policies tab bar */}
      <div className="relative mx-auto w-full max-w-[var(--max-width)]">
        <div className="relative h-[calc(260px+1.5in)] overflow-hidden bg-[#f0f0f0] md:h-[calc(320px+1.5in)]">
          {seller.coverPhotoUrl ? (
            <Image
              src={seller.coverPhotoUrl}
              alt=""
              fill
              className="object-cover"
              priority
              quality={75}
              unoptimized={seller.coverPhotoUrl.startsWith("blob:")}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <IonIcon name="storefront" size={64} className="text-black/15" />
            </div>
          )}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/60 to-transparent"
            aria-hidden
          />
        </div>
        <div className="absolute left-1/2 bottom-0 z-10 h-[179px] w-[179px] -translate-x-1/2 translate-y-1/2 overflow-hidden rounded-xl border-4 border-white bg-white shadow-md md:h-[205px] md:w-[205px]">
          {seller.logoUrl ? (
            <Image
              src={seller.logoUrl}
              alt={seller.name}
              width={205}
              height={205}
              className="h-full w-full object-cover"
              quality={75}
              unoptimized={seller.logoUrl.startsWith("blob:")}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-[#f5f5f5]">
              <IonIcon name="business" size={64} className="text-[var(--color-primary)]" />
            </div>
          )}
        </div>
      </div>

      {/* Name + actions */}
      <div className="mx-auto w-full max-w-[var(--max-width)] px-4 pb-4 pt-[106px] text-center md:pt-[120px]">
        <p
          className="mb-3 text-2xl font-medium leading-tight md:text-3xl"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          {seller.name}
        </p>
        <div className="flex w-full flex-nowrap items-stretch justify-center gap-2">
          <FollowBusinessButton
            businessId={seller.id}
            variant="pill"
            tone="primary"
            className="min-w-0 flex-1"
          />
          <div className="min-w-0 flex-1">
            <ShareButton
              type="seller"
              id={seller.id}
              slug={seller.slug}
              title={seller.name}
              variant="full"
              tone="earth"
              label="Share"
              iconSize={18}
              className="!w-full !shadow-none"
            />
          </div>
          {seller.acceptMessagesForListings ? (
            <button
              type="button"
              onClick={openMessage}
              className="action-pill action-pill-lg btn-pill-tan min-w-0 flex-1 disabled:opacity-60"
            >
              <IonIcon name="chatbubble-outline" size={18} className="text-[var(--color-earth)]" />
              Message
            </button>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-[52px] z-20 mx-auto w-full max-w-[var(--max-width)] border-t-2 border-b-2 border-[var(--color-primary)] bg-white md:top-[56px]">
        <div className="flex">
          {(
            [
              { id: "products" as const, label: "Products" },
              { id: "about" as const, label: "About" },
              { id: "policies" as const, label: "Policies" },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3.5 text-[15px] font-semibold transition-colors ${
                  active
                    ? "bg-[var(--color-primary)] text-white"
                    : "bg-white text-[#666] hover:bg-[var(--color-section-alt)]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mx-auto max-w-[var(--max-width)] px-4 py-4 pb-12">
        {activeTab === "products" ? (
          <>
            {categories.length > 0 ? (
              <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: "thin" }}>
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className={`shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-medium ${
                    !selectedCategory
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                      : "border-[#e0e0e0] bg-[#f0f0f0] text-[#666]"
                  }`}
                >
                  All ({seller.storeItems.length})
                </button>
                {categories.map((cat) => {
                  const count = seller.storeItems.filter((i) => i.category === cat).length;
                  const active = selectedCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`shrink-0 rounded-full border px-3.5 py-2 text-[13px] font-medium ${
                        active
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                          : "border-[#e0e0e0] bg-[#f0f0f0] text-[#666]"
                      }`}
                    >
                      {cat} ({count})
                    </button>
                  );
                })}
              </div>
            ) : null}
            {filteredItems.length === 0 ? (
              <div className="flex flex-col items-center py-12 text-center">
                <IonIcon name="cube-outline" size={48} className="text-[#ccc]" />
                <p className="mt-3 text-[15px] text-[#888]">
                  {selectedCategory ? `No products in "${selectedCategory}"` : "No products listed yet"}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
                {filteredItems.map((item) => (
                  <StorefrontCard
                    key={item.id}
                    item={item}
                    savedIds={savedIds}
                    productHref={buildProductLinkWithReferrer(item.slug, seller.slug, seller.name)}
                    showBusiness={false}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}

        {activeTab === "about" ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-center gap-6 border-b border-[#eee] pb-4">
              <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--color-text)" }}>
                <IonIcon name="calendar-outline" size={20} className="text-[var(--color-primary)]" />
                Member since {seller.memberSince}
              </span>
              <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--color-text)" }}>
                <IonIcon name="cube-outline" size={20} className="text-[var(--color-primary)]" />
                {seller.storeItems.length} items
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {seller.offerShipping ? (
                <span className={FULFILLMENT_BADGE}>
                  <IonIcon name="airplane-outline" size={16} />
                  Ships items
                </span>
              ) : null}
              {seller.offerLocalPickup ? (
                <span className={FULFILLMENT_BADGE}>
                  <IonIcon name="storefront-outline" size={16} />
                  Local pickup
                </span>
              ) : null}
              {seller.offerLocalDelivery ? (
                <span className={FULFILLMENT_BADGE}>
                  <IonIcon name="car-outline" size={16} />
                  Local delivery
                </span>
              ) : null}
              {hasHours ? (
                <button
                  type="button"
                  className={FULFILLMENT_BADGE}
                  onClick={() => {
                    setHoursExpanded(true);
                    hoursSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  <IonIcon name="time-outline" size={16} />
                  Hours of operation
                </button>
              ) : null}
            </div>

            {(seller.phone || seller.email || seller.website) ? (
              <div>
                <h2 className="mb-2.5 text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                  Contact
                </h2>
                <ul className="space-y-2">
                  {seller.phone ? (
                    <li>
                      <a
                        href={`tel:${seller.phone.replace(/\s/g, "")}`}
                        className="inline-flex items-center gap-2 text-[15px] font-medium text-[var(--color-primary)] hover:opacity-90"
                      >
                        <IonIcon name="call-outline" size={18} />
                        {seller.phone}
                      </a>
                    </li>
                  ) : null}
                  {seller.email ? (
                    <li>
                      <a
                        href={`mailto:${seller.email}`}
                        className="inline-flex items-center gap-2 break-all text-[15px] font-medium text-[var(--color-primary)] hover:opacity-90"
                      >
                        <IonIcon name="mail-outline" size={18} />
                        {seller.email}
                      </a>
                    </li>
                  ) : null}
                  {seller.website ? (
                    <li>
                      <a
                        href={formatWebsiteHref(seller.website)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 break-all text-[15px] font-medium text-[var(--color-primary)] hover:opacity-90"
                      >
                        <IonIcon name="globe-outline" size={18} />
                        {seller.website}
                      </a>
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}

            {hasSocial ? (
              <div className="flex gap-3">
                {seller.facebookUrl ? (
                  <a
                    href={seller.facebookUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-primary)] hover:opacity-90"
                    aria-label="Facebook"
                  >
                    <IonIcon name="logo-facebook" size={22} className="text-white" />
                  </a>
                ) : null}
                {seller.instagramUrl ? (
                  <a
                    href={seller.instagramUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-primary)] hover:opacity-90"
                    aria-label="Instagram"
                  >
                    <IonIcon name="logo-instagram" size={22} className="text-white" />
                  </a>
                ) : null}
                {seller.tiktokUrl ? (
                  <a
                    href={seller.tiktokUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-primary)] hover:opacity-90"
                    aria-label="TikTok"
                  >
                    <IonIcon name="logo-tiktok" size={22} className="text-white" />
                  </a>
                ) : null}
              </div>
            ) : null}

            {seller.addressDisplay ? (
              <div>
                <h2 className="mb-2.5 text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                  Location
                </h2>
                <p className="flex items-start gap-2 text-[15px]" style={{ color: "var(--color-text)" }}>
                  <IonIcon name="location-outline" size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" />
                  <span>{seller.addressDisplay}</span>
                </p>
                {seller.googleMapsUrl ? (
                  <a
                    href={seller.googleMapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-primary)] py-2.5 text-sm font-semibold text-white hover:opacity-90"
                  >
                    <IonIcon name="map-outline" size={18} className="text-white" />
                    Open in Maps
                  </a>
                ) : null}
              </div>
            ) : null}

            {hasHours && seller.hoursOfOperation ? (
              <div ref={hoursSectionRef} className="scroll-mt-28">
                <button
                  type="button"
                  onClick={() => setHoursExpanded((v) => !v)}
                  className="flex w-full items-center justify-between"
                >
                  <h2 className="text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                    Hours of Operation
                  </h2>
                  <IonIcon
                    name={hoursExpanded ? "chevron-up" : "chevron-down"}
                    size={20}
                    className="text-[var(--color-primary)]"
                  />
                </button>
                {hoursExpanded ? (
                  <ul className="mt-2 space-y-1">
                    {DAY_ORDER.map((day) => {
                      const val = seller.hoursOfOperation?.[day];
                      if (!val) return null;
                      return (
                        <li key={day} className="flex justify-between text-[15px]" style={{ color: "var(--color-text)" }}>
                          <span className="w-28 capitalize">{day}</span>
                          <span className="text-right">{val}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {seller.galleryPhotos.length > 0 ? (
              <div>
                <div className="mb-2.5 flex items-center justify-between">
                  <h2 className="text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                    Gallery
                  </h2>
                  <span className="rounded-xl bg-[var(--color-section-alt)] px-2.5 py-1 text-xs font-semibold text-[var(--color-primary)]">
                    {seller.galleryPhotos.length} photos
                  </span>
                </div>
                <BusinessHorizontalGallery photos={seller.galleryPhotos} alt={seller.name} />
              </div>
            ) : null}

            {(seller.shortDescription || seller.fullDescription) ? (
              <div>
                <button
                  type="button"
                  onClick={() => setAboutExpanded((v) => !v)}
                  className="flex w-full items-center justify-between"
                >
                  <h2 className="text-base font-semibold" style={{ color: "var(--color-heading)" }}>
                    About
                  </h2>
                  <IonIcon
                    name={aboutExpanded ? "chevron-up" : "chevron-down"}
                    size={20}
                    className="text-[var(--color-primary)]"
                  />
                </button>
                {aboutExpanded ? (
                  <div className="mt-2 space-y-3 text-[15px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--color-text)" }}>
                    {seller.shortDescription ? <p>{seller.shortDescription}</p> : null}
                    {seller.fullDescription ? <p>{seller.fullDescription}</p> : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            <Link
              href={buildBusinessHref(seller.slug, { type: "seller", sellerSlug: seller.slug })}
              className="action-pill action-pill-lg btn-pill-primary w-full"
            >
              <IonIcon name="business-outline" size={18} className="text-white" />
              View Business Directory Page
            </Link>
          </div>
        ) : null}

        {activeTab === "policies" ? (
          !hasPolicies ? (
            <div className="flex flex-col items-center py-12 text-center">
              <IonIcon name="document-text-outline" size={48} className="text-[#ccc]" />
              <p className="mt-3 text-[15px] text-[#888]">This seller hasn&apos;t set up policies yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {seller.sellerShippingPolicy ? (
                <PolicyCard icon="airplane-outline" title="Shipping Policy" text={seller.sellerShippingPolicy} />
              ) : null}
              {seller.sellerLocalDeliveryPolicy ? (
                <PolicyCard icon="car-outline" title="Local Delivery Policy" text={seller.sellerLocalDeliveryPolicy} />
              ) : null}
              {seller.sellerPickupPolicy ? (
                <PolicyCard icon="storefront-outline" title="Pickup Policy" text={seller.sellerPickupPolicy} />
              ) : null}
              {seller.sellerReturnPolicy ? (
                <PolicyCard icon="refresh-outline" title="Return Policy" text={seller.sellerReturnPolicy} />
              ) : null}
            </div>
          )
        ) : null}
      </div>

      {messageOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          role="dialog"
          aria-modal
          aria-labelledby="message-seller-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 id="message-seller-title" className="text-lg font-bold" style={{ color: "var(--color-heading)" }}>
              Message {seller.name}
            </h2>
            <p className="mb-4 text-sm text-[#666]">Send a message to this seller</p>
            <textarea
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type your message..."
              rows={4}
              disabled={sendingMessage}
              className="w-full resize-y rounded-lg border-2 border-[var(--color-primary)] p-3 text-sm outline-none"
            />
            {messageError ? <p className="mt-2 text-sm text-red-600">{messageError}</p> : null}
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => !sendingMessage && setMessageOpen(false)}
                disabled={sendingMessage}
                className="rounded-lg bg-[#f0f0f0] px-5 py-2.5 text-sm font-semibold text-[#666]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={sendMessage}
                disabled={!messageText.trim() || sendingMessage}
                className="min-w-[80px] rounded-lg bg-[var(--color-primary)] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {sendingMessage ? "…" : "Send"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PolicyCard({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-[#e0e0e0] bg-white p-4 shadow-sm">
      <div className="mb-2.5 flex items-center gap-2.5">
        <IonIcon name={icon} size={20} className="text-[var(--color-primary)]" />
        <h3 className="text-[15px] font-semibold" style={{ color: "var(--color-heading)" }}>
          {title}
        </h3>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
        {text}
      </p>
    </div>
  );
}
