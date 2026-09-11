"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SellerProfileEdit } from "@/components/SellerProfileEdit";
import { IonIcon } from "@/components/IonIcon";

interface SellerProfile {
  member: {
    firstName: string;
    lastName: string;
    email: string;
    acceptOffersOnResale?: boolean;
    acceptMessagesForListings?: boolean;
  } | null;
  business: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    fullDescription: string | null;
    website: string | null;
    address: string | null;
    logoUrl: string | null;
    coverPhotoUrl?: string | null;
    slug: string;
  } | null;
  hasStripeConnect: boolean;
  packingSlipNote?: string | null;
  sellerLocalDeliveryPolicy?: string | null;
  sellerPickupPolicy?: string | null;
  sellerShippingPolicy?: string | null;
  sellerReturnPolicy?: string | null;
}

function pageChecks(biz: SellerProfile["business"]) {
  return [
    { id: "logo", label: "Logo", done: Boolean(biz?.logoUrl) },
    { id: "cover", label: "Cover", done: Boolean(biz?.coverPhotoUrl) },
    { id: "story", label: "Story", done: Boolean(biz?.fullDescription?.trim()) },
    { id: "contact", label: "Contact", done: Boolean(biz?.phone?.trim() || biz?.email?.trim()) },
    { id: "place", label: "Address", done: Boolean(biz?.address?.trim()) },
  ];
}

export default function SellerProfilePage() {
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    fetch("/api/seller-profile")
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, []);

  function onSaved() {
    fetch("/api/seller-profile")
      .then((r) => r.json())
      .then(setProfile);
  }

  if (loading) {
    return <p className="text-[var(--color-text)]">Loading…</p>;
  }

  if (editing) {
    return (
      <div className="w-full min-w-0 max-w-2xl mx-auto">
        <SellerProfileEdit profile={profile} onSaved={onSaved} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  const biz = profile?.business;
  const member = profile?.member;
  const checks = pageChecks(biz ?? null);
  const doneCount = checks.filter((c) => c.done).length;

  return (
    <div className="mx-auto w-full max-w-2xl min-w-0">
      <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--color-earth)]">Your shopfront</p>
      <h1
        className="mb-2 text-2xl font-bold"
        style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
      >
        This is what buyers see first
      </h1>
      <p className="mb-5 text-sm leading-6 text-[var(--color-text)]">
        Dress it up with a cover, logo, and a short story. Shoppers decide in a few seconds whether to trust the booth.
      </p>

      <div className="mb-4 overflow-hidden rounded-xl border border-[#e6e0d6] bg-white text-center">
        <div className="relative aspect-[16/9] bg-[#FDEDCC]">
          {biz?.coverPhotoUrl ? (
            <img src={biz.coverPhotoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-[var(--color-earth)]">
              <IonIcon name="image-outline" size={36} />
              <span className="text-sm font-semibold">Add a cover photo</span>
            </div>
          )}
        </div>
        <div className="-mt-9 mb-3 flex justify-center">
          <div className="h-[72px] w-[72px] overflow-hidden rounded-xl border-[3px] border-white bg-white shadow-sm">
            {biz?.logoUrl ? (
              <img src={biz.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#FDEDCC] text-[var(--color-earth)]">
                <IonIcon name="storefront-outline" size={28} />
              </div>
            )}
          </div>
        </div>
        <h2 className="px-4 text-xl font-bold" style={{ color: "var(--color-heading)" }}>
          {biz?.name || "Your shop"}
        </h2>
        {biz?.fullDescription ? (
          <p className="mx-auto mt-2 max-w-prose px-4 pb-5 text-sm leading-6 text-[var(--color-text)]">
            {biz.fullDescription}
          </p>
        ) : (
          <p className="px-4 pb-5 text-sm italic text-[#888]">A sentence about what you make or sell goes here.</p>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-[#e6e0d6] bg-white p-4">
        <p className="mb-3 text-sm font-bold" style={{ color: "var(--color-heading)" }}>
          {doneCount === checks.length ? "Looking sharp" : `${doneCount} of ${checks.length} shopper magnets`}
        </p>
        <div className="flex flex-wrap gap-2">
          {checks.map((c) => (
            <span
              key={c.id}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                c.done
                  ? "border-[#c99d5f] bg-[#FDEDCC] text-[#c99d5f]"
                  : "border-[#e6e0d6] bg-[#FFF8E1] text-[var(--color-text)]"
              }`}
            >
              <IonIcon name={c.done ? "checkmark-circle" : "ellipse-outline"} size={14} />
              {c.label}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-[var(--color-earth)] px-5 py-3 text-base font-bold text-white hover:opacity-90"
        >
          <IonIcon name="create-outline" size={18} />
          Edit Seller Page
        </button>
        {biz?.slug ? (
          <Link
            href={`/support-local/sellers/${biz.slug}`}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border-2 border-[var(--color-earth)] bg-white px-5 py-3 text-base font-bold text-[var(--color-earth)] hover:bg-[#FFF8E1]"
          >
            <IonIcon name="open-outline" size={18} />
            View Shop
          </Link>
        ) : null}
      </div>

      <div className="space-y-3">
        <section className="rounded-xl border border-[#e6e0d6] bg-white p-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[#888]">Contact</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold text-[#888]">Phone</dt>
              <dd className="break-words font-medium" style={{ color: "var(--color-heading)" }}>
                {biz?.phone ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[#888]">Email</dt>
              <dd className="break-all font-medium" style={{ color: "var(--color-heading)" }}>
                {biz?.email ?? member?.email ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[#888]">Website</dt>
              <dd className="break-all font-medium" style={{ color: "var(--color-heading)" }}>
                {biz?.website ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[#888]">Address</dt>
              <dd className="break-words font-medium" style={{ color: "var(--color-heading)" }}>
                {biz?.address ?? "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-[#e6e0d6] bg-white p-4">
          <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-[#888]">How you sell</h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold text-[#888]">Offers on Resale</dt>
              <dd className="font-medium" style={{ color: "var(--color-heading)" }}>
                {member?.acceptOffersOnResale !== false ? "On" : "Off"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-[#888]">Buyer Messages</dt>
              <dd className="font-medium" style={{ color: "var(--color-heading)" }}>
                {member?.acceptMessagesForListings !== false ? "On" : "Off"}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}
