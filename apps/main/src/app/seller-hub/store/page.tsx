"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { SellerProfileEdit } from "@/components/SellerProfileEdit";

interface SellerProfile {
  member: { firstName: string; lastName: string; email: string } | null;
  business: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    fullDescription: string | null;
    website: string | null;
    address: string | null;
    logoUrl: string | null;
    slug: string;
  } | null;
  hasStripeConnect: boolean;
  sellerLocalDeliveryPolicy?: string | null;
  sellerPickupPolicy?: string | null;
  sellerShippingPolicy?: string | null;
  sellerReturnPolicy?: string | null;
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
    setEditing(false);
    fetch("/api/seller-profile")
      .then((r) => r.json())
      .then(setProfile);
  }

  if (loading) {
    return <p className="text-gray-500">Loading…</p>;
  }

  if (editing) {
    return (
      <div className="w-full min-w-0 max-w-full overflow-hidden">
        <SellerProfileEdit profile={profile} onSaved={onSaved} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  const biz = profile?.business;
  const member = profile?.member;
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="w-full max-md:flex max-md:flex-col max-md:items-center max-md:overflow-x-hidden">
      <div className="w-full max-w-[var(--max-width)] max-md:mx-auto max-md:px-4 min-w-0">
        <h1 className="text-2xl font-bold mb-6 max-md:text-center">Northwest Community Seller Page</h1>
        <div className="max-md:flex max-md:justify-center max-md:mb-6">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="btn px-8 py-3"
          >
            Edit Seller Profile
          </button>
        </div>

        <div className="space-y-6 min-w-0">
          <section className="border rounded-lg p-6 bg-gray-50 min-w-0 overflow-hidden">
          <h2 className="text-lg font-semibold mb-4">Store Information</h2>
          <div className="grid gap-4 min-w-0">
            <div className="min-w-0">
              <label className="block text-xs text-gray-500 mb-0.5">Company Name</label>
              <p className="font-medium break-words">{biz?.name ?? "—"}</p>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-gray-500 mb-0.5">Company Phone Number</label>
              <p className="break-words">{biz?.phone ?? "—"}</p>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-gray-500 mb-0.5">Contact Email</label>
              <p className="break-all">{biz?.email ?? member?.email ?? "—"}</p>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-gray-500 mb-0.5">Store Description</label>
              <p className="text-sm whitespace-pre-wrap break-words">{biz?.fullDescription ?? "—"}</p>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-gray-500 mb-0.5">Business Website</label>
              <p className="text-primary-600 break-all">{biz?.website ?? "—"}</p>
            </div>
            <div className="min-w-0">
              <label className="block text-xs text-gray-500 mb-0.5">Storefront Address</label>
              <p className="break-words">{biz?.address ?? "—"}</p>
            </div>
            {biz?.logoUrl && (
              <div className="min-w-0">
                <label className="block text-xs text-gray-500 mb-0.5">Logo</label>
                <img
                  src={biz.logoUrl}
                  alt="Store logo"
                  className="w-24 h-24 rounded-full object-cover"
                />
              </div>
            )}
            {biz?.slug && (
              <div className="min-w-0">
                <label className="block text-xs text-gray-500 mb-0.5">NWC Sponsor Page Link</label>
                <Link
                  href={`/support-local/${biz.slug}`}
                  className="text-primary-600 hover:underline text-sm break-all block"
                >
                  {baseUrl}/support-local/{biz.slug}
                </Link>
              </div>
            )}
          </div>
        </section>

        <section className="border rounded-lg p-6 bg-gray-50 min-w-0 overflow-hidden">
          <h2 className="text-lg font-semibold mb-4">Seller Policy</h2>
          <div className="space-y-4 min-w-0">
            <div className="min-w-0">
              <h3 className="font-medium text-sm mb-1">Local Delivery Policy</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">
                {(profile as SellerProfile & { sellerLocalDeliveryPolicy?: string | null })
                  ?.sellerLocalDeliveryPolicy ?? "Not set."}
              </p>
            </div>
            <div className="min-w-0">
              <h3 className="font-medium text-sm mb-1">Pickup Policy</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">
                {(profile as SellerProfile & { sellerPickupPolicy?: string | null })
                  ?.sellerPickupPolicy ?? "Not set."}
              </p>
            </div>
            <div className="min-w-0">
              <h3 className="font-medium text-sm mb-1">Shipping Policy</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">
                {(profile as SellerProfile & { sellerShippingPolicy?: string | null })
                  ?.sellerShippingPolicy ?? "Not set."}
              </p>
            </div>
            <div className="min-w-0">
              <h3 className="font-medium text-sm mb-1">Return Policy</h3>
              <p className="text-sm text-gray-600 whitespace-pre-wrap break-words">
                {(profile as SellerProfile & { sellerReturnPolicy?: string | null })
                  ?.sellerReturnPolicy ?? "Not set."}
              </p>
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
