"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { normalizeWebsiteUrl } from "@/lib/website-url";

async function uploadFile(file: File, opts?: { purpose?: "business-logo" }): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  if (opts?.purpose) formData.append("purpose", opts.purpose);
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
      coverPhotoUrl?: string | null;
      slug: string;
    } | null;
    packingSlipNote?: string | null;
  } | null;
  onSaved: () => void;
  onCancel: () => void;
}

export function SellerProfileEdit({ profile, onSaved, onCancel }: SellerProfileEditProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [packingSlipNote, setPackingSlipNote] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverPhotoUrl, setCoverPhotoUrl] = useState("");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [sellerSlug, setSellerSlug] = useState(profile?.business?.slug ?? "");

  useLockBodyScroll(savedOpen);

  useEffect(() => {
    if (profile?.business) {
      setName(profile.business.name);
      setPhone(profile.business.phone ?? "");
      setEmail(profile.business.email ?? "");
      setFullDescription(profile.business.fullDescription ?? "");
      setWebsite(profile.business.website ?? "");
      setAddress(profile.business.address ?? "");
      setLogoUrl(profile.business.logoUrl ?? "");
      setCoverPhotoUrl((profile.business as { coverPhotoUrl?: string | null }).coverPhotoUrl ?? "");
      setSellerSlug(profile.business.slug ?? "");
    }
    if (profile) {
      setPackingSlipNote(profile.packingSlipNote ?? "");
    }
  }, [profile]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const websiteUrl = normalizeWebsiteUrl(website);
    setWebsite(websiteUrl);
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
            website: websiteUrl || null,
            address: address.trim() || null,
            logoUrl: logoUrl.trim() || null,
            coverPhotoUrl: coverPhotoUrl.trim() || null,
          },
          packingSlipNote: packingSlipNote.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      let slug = sellerSlug || profile?.business?.slug || "";
      if (!slug) {
        try {
          const refreshed = await fetch("/api/seller-profile", { credentials: "include" }).then((r) =>
            r.json()
          );
          slug =
            typeof refreshed?.business?.slug === "string" ? refreshed.business.slug : "";
        } catch {
          slug = "";
        }
      }
      setSellerSlug(slug);
      setSavedOpen(true);
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
                      const url = await uploadFile(file, { purpose: "business-logo" });
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
            <label className="block text-sm font-medium mb-1">Storefront Cover Photo</label>
            <p className="text-xs text-gray-500 mb-2">Facebook-style backdrop for your seller storefront. Recommended 820×312 px.</p>
            <div className="flex items-center gap-4">
              {coverPhotoUrl ? (
                <div className="relative">
                  <img src={coverPhotoUrl} alt="Cover" className="w-40 h-24 object-cover border rounded" />
                  <button type="button" onClick={() => setCoverPhotoUrl("")} className="text-red-600 text-sm mt-1 hover:underline">
                    Remove
                  </button>
                </div>
              ) : null}
              <input
                type="file"
                accept="image/*"
                disabled={uploadingCover}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setUploadingCover(true);
                  setError("");
                  try {
                    const url = await uploadFile(file);
                    setCoverPhotoUrl(url);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Upload failed");
                  } finally {
                    setUploadingCover(false);
                    e.target.value = "";
                  }
                }}
                className="text-sm"
              />
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
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              onBlur={() => setWebsite(normalizeWebsiteUrl(website))}
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
      {savedOpen ? (
        <div
          className="fixed inset-0 z-[270] flex items-center justify-center p-4 bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="seller-page-saved-title"
        >
          <div
            className="relative z-10 w-full max-w-md rounded-xl border-2 bg-white p-6 shadow-xl text-center"
            style={{ borderColor: "var(--color-primary)" }}
          >
            <h3
              id="seller-page-saved-title"
              className="text-lg font-bold mb-5"
              style={{ color: "var(--color-heading)" }}
            >
              Your Seller Page has been saved.
            </h3>
            <div className="flex flex-col gap-3">
              <button type="button" className="btn w-full" onClick={() => router.push("/seller-hub")}>
                Return to Seller Hub
              </button>
              {sellerSlug ? (
                <a
                  href={`/support-local/sellers/${sellerSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn w-full inline-flex items-center justify-center"
                >
                  See Seller Page
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
}
