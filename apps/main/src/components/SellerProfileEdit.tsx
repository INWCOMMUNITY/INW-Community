"use client";

import { useState, useEffect } from "react";

async function uploadFile(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Upload failed");
  const url = data.url;
  if (!url) throw new Error("No URL returned");
  if (url.startsWith("/")) return `${typeof window !== "undefined" ? window.location.origin : ""}${url}`;
  return url;
}

interface SellerProfileEditProps {
  profile: {
    member?: { firstName: string; lastName: string; email: string } | null;
    business?: {
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
    sellerLocalDeliveryPolicy?: string | null;
    sellerPickupPolicy?: string | null;
    sellerShippingPolicy?: string | null;
    sellerReturnPolicy?: string | null;
    packingSlipNote?: string | null;
  } | null;
  onSaved: () => void;
  onCancel: () => void;
}

export function SellerProfileEdit({ profile, onSaved, onCancel }: SellerProfileEditProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [localDeliveryPolicy, setLocalDeliveryPolicy] = useState("");
  const [pickupPolicy, setPickupPolicy] = useState("");
  const [shippingPolicy, setShippingPolicy] = useState("");
  const [returnPolicy, setReturnPolicy] = useState("");
  const [packingSlipNote, setPackingSlipNote] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  useEffect(() => {
    if (profile?.business) {
      setName(profile.business.name);
      setPhone(profile.business.phone ?? "");
      setEmail(profile.business.email ?? "");
      setFullDescription(profile.business.fullDescription ?? "");
      setWebsite(profile.business.website ?? "");
      setAddress(profile.business.address ?? "");
    }
    if (profile) {
      setLocalDeliveryPolicy(
        (profile as { sellerLocalDeliveryPolicy?: string | null }).sellerLocalDeliveryPolicy ?? ""
      );
      setPickupPolicy(
        (profile as { sellerPickupPolicy?: string | null }).sellerPickupPolicy ?? ""
      );
      setShippingPolicy(
        (profile as { sellerShippingPolicy?: string | null }).sellerShippingPolicy ?? ""
      );
      setReturnPolicy(
        (profile as { sellerReturnPolicy?: string | null }).sellerReturnPolicy ?? ""
      );
    }
  }, [profile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/seller-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business: {
            name: name.trim() || "My Store",
            phone: phone.trim() || null,
            email: email.trim() || null,
            fullDescription: fullDescription.trim() || null,
            website: website.trim() || null,
            address: address.trim() || null,
            logoUrl: logoUrl.trim() || null,
          },
          sellerLocalDeliveryPolicy: localDeliveryPolicy.trim() || null,
          sellerPickupPolicy: pickupPolicy.trim() || null,
          sellerShippingPolicy: shippingPolicy.trim() || null,
          sellerReturnPolicy: returnPolicy.trim() || null,
          packingSlipNote: packingSlipNote.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 min-w-0 max-w-full overflow-hidden">
      <h2 className="text-xl font-bold">Edit Seller Profile</h2>

      <section className="border rounded-lg p-6 bg-gray-50 min-w-0 overflow-hidden">
        <h3 className="font-semibold mb-4">Store Information</h3>
        <div className="grid gap-4 min-w-0">
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Store Logo</label>
            <div className="flex items-center gap-4">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Store logo"
                  className="w-20 h-20 rounded-full object-cover border-2 border-gray-300"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
                  No logo
                </div>
              )}
              <div>
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingLogo}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadingLogo(true);
                    setError("");
                    try {
                      const url = await uploadFile(file);
                      setLogoUrl(url);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Upload failed");
                    } finally {
                      setUploadingLogo(false);
                      e.target.value = "";
                    }
                  }}
                  className="text-sm"
                />
                {logoUrl && (
                  <button
                    type="button"
                    onClick={() => setLogoUrl("")}
                    className="text-red-600 text-sm mt-1 hover:underline"
                  >
                    Remove logo
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Company Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Company Phone Number</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Contact Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Store Description</label>
            <textarea
              value={fullDescription}
              onChange={(e) => setFullDescription(e.target.value)}
              rows={4}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Business Website</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
              placeholder="https://"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Storefront Address</label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
            />
          </div>
        </div>
      </section>

      <section className="border rounded-lg p-6 bg-gray-50 min-w-0 overflow-hidden">
        <h3 className="font-semibold mb-4">Seller Policy</h3>
        <div className="grid gap-4 min-w-0">
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">
              Local Delivery Policy
            </label>
            <textarea
              value={localDeliveryPolicy}
              onChange={(e) => setLocalDeliveryPolicy(e.target.value)}
              rows={3}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
              placeholder="Describe your local delivery areas, fees, and how you coordinate delivery..."
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Pickup Policy</label>
            <textarea
              value={pickupPolicy}
              onChange={(e) => setPickupPolicy(e.target.value)}
              rows={3}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
              placeholder="Describe where and when buyers can pick up items (e.g. location, contact method, hours)..."
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Shipping Policy</label>
            <textarea
              value={shippingPolicy}
              onChange={(e) => setShippingPolicy(e.target.value)}
              rows={3}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
              placeholder="e.g. 2-5 business days via USPS. Free over $50."
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Return Policy</label>
            <textarea
              value={returnPolicy}
              onChange={(e) => setReturnPolicy(e.target.value)}
              rows={3}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
              placeholder="Describe your return policy..."
            />
          </div>
          <div className="min-w-0">
            <label className="block text-sm font-medium mb-1">Packing Slip Note</label>
            <textarea
              value={packingSlipNote}
              onChange={(e) => setPackingSlipNote(e.target.value)}
              rows={2}
              className="w-full max-w-full min-w-0 border rounded px-3 py-2 box-border"
              placeholder="Custom message on printed packing slips (e.g. Thank you for your order!)"
            />
          </div>
        </div>
      </section>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={saving} className="btn">
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="btn border border-gray-300 bg-white">
          Cancel
        </button>
      </div>
    </form>
  );
}
