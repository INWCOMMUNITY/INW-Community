"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { normalizeWebsiteUrl } from "@/lib/website-url";
import { IonIcon } from "@/components/IonIcon";

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
    member?: {
      firstName: string;
      lastName: string;
      email: string;
      acceptOffersOnResale?: boolean;
      acceptMessagesForListings?: boolean;
    } | null;
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

const fieldClass =
  "w-full max-w-full min-w-0 rounded-lg border border-[#e6e0d6] bg-[#FFF8E1] px-3 py-2.5 box-border text-[var(--color-heading)]";

export function SellerProfileEdit({ profile, onSaved, onCancel }: SellerProfileEditProps) {
  const router = useRouter();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [packingSlipNote, setPackingSlipNote] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverPhotoUrl, setCoverPhotoUrl] = useState("");
  const [acceptOffersOnResale, setAcceptOffersOnResale] = useState(true);
  const [acceptMessagesForListings, setAcceptMessagesForListings] = useState(true);
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
    if (profile?.member) {
      if (typeof profile.member.acceptOffersOnResale === "boolean") {
        setAcceptOffersOnResale(profile.member.acceptOffersOnResale);
      }
      if (typeof profile.member.acceptMessagesForListings === "boolean") {
        setAcceptMessagesForListings(profile.member.acceptMessagesForListings);
      }
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
          acceptOffersOnResale,
          acceptMessagesForListings,
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
          slug = typeof refreshed?.business?.slug === "string" ? refreshed.business.slug : "";
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
    <form onSubmit={handleSubmit} className="space-y-4 min-w-0 max-w-full">
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-[var(--color-earth)]">Edit seller page</p>
        <h2
          className="mt-1 text-xl font-bold"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
        >
          Make the booth feel like you
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text)]">
          Click the cover or logo to swap photos. Shoppers see this at the top of your page.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#e6e0d6] bg-white text-center">
        <button
          type="button"
          className="relative block aspect-[16/9] w-full bg-[#FDEDCC]"
          onClick={() => coverInputRef.current?.click()}
          disabled={uploadingCover}
        >
          {uploadingCover ? (
            <span className="text-sm font-semibold text-[var(--color-earth)]">Uploading…</span>
          ) : coverPhotoUrl ? (
            <img src={coverPhotoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full flex-col items-center justify-center gap-1 text-[var(--color-earth)]">
              <IonIcon name="camera-outline" size={32} />
              <span className="text-sm font-bold">Click to add a cover</span>
              <span className="text-xs">A booth, workshop, or favorite piece</span>
            </span>
          )}
          {coverPhotoUrl && !uploadingCover ? (
            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-[rgba(93,79,64,0.88)] px-2.5 py-1 text-xs font-bold text-white">
              <IonIcon name="camera-outline" size={14} />
              Change cover
            </span>
          ) : null}
        </button>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploadingCover}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploadingCover(true);
            setError("");
            try {
              setCoverPhotoUrl(await uploadFile(file));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Upload failed");
            } finally {
              setUploadingCover(false);
              e.target.value = "";
            }
          }}
        />
        <button
          type="button"
          className="-mt-9 mb-2 inline-flex h-[72px] w-[72px] overflow-hidden rounded-xl border-[3px] border-white bg-white shadow-sm"
          onClick={() => logoInputRef.current?.click()}
          disabled={uploadingLogo}
          aria-label="Change logo"
        >
          {uploadingLogo ? (
            <span className="flex h-full w-full items-center justify-center bg-[#FDEDCC] text-xs font-semibold text-[var(--color-earth)]">
              …
            </span>
          ) : logoUrl ? (
            <img src={logoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-[#FDEDCC] text-[var(--color-earth)]">
              <IonIcon name="add" size={28} />
            </span>
          )}
        </button>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={uploadingLogo}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploadingLogo(true);
            setError("");
            try {
              setLogoUrl(await uploadFile(file, { purpose: "business-logo" }));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Upload failed");
            } finally {
              setUploadingLogo(false);
              e.target.value = "";
            }
          }}
        />
        <div className="flex justify-center gap-4 pb-3 text-xs font-semibold">
          {logoUrl ? (
            <button type="button" className="text-red-600 hover:underline" onClick={() => setLogoUrl("")}>
              Remove logo
            </button>
          ) : (
            <span className="text-[#888]">Click the square for your logo</span>
          )}
          {coverPhotoUrl ? (
            <button type="button" className="text-red-600 hover:underline" onClick={() => setCoverPhotoUrl("")}>
              Remove cover
            </button>
          ) : null}
        </div>
      </div>

      <section className="rounded-xl border border-[#e6e0d6] bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[#888]">The story</h3>
        <div>
          <label className="mb-1 block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            Shop name
          </label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            What you sell
          </label>
          <textarea
            value={fullDescription}
            onChange={(e) => setFullDescription(e.target.value)}
            rows={4}
            placeholder="Handmade soaps, vintage denim, farm eggs on Saturdays…"
            className={fieldClass}
          />
        </div>
      </section>

      <section className="rounded-xl border border-[#e6e0d6] bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[#888]">How to find you</h3>
        <div>
          <label className="mb-1 block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            Phone
          </label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            Email
          </label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            Website
          </label>
          <input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            onBlur={() => setWebsite(normalizeWebsiteUrl(website))}
            className={fieldClass}
            placeholder="https://"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            Storefront address
          </label>
          <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
            Packing slip note
          </label>
          <textarea
            value={packingSlipNote}
            onChange={(e) => setPackingSlipNote(e.target.value)}
            rows={2}
            className={fieldClass}
            placeholder="Thank you for your order!"
          />
        </div>
      </section>

      <section className="rounded-xl border border-[#e6e0d6] bg-white p-4 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[#888]">How you sell</h3>
        <label className="flex cursor-pointer items-start justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
              Take offers on Resale items
            </span>
            <span className="mt-0.5 block text-xs text-[var(--color-text)]">
              Default for new resale listings. You can still change this per item.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={acceptOffersOnResale}
            onChange={(e) => setAcceptOffersOnResale(e.target.checked)}
          />
        </label>
        <label className="flex cursor-pointer items-start justify-between gap-3">
          <span>
            <span className="block text-sm font-semibold" style={{ color: "var(--color-heading)" }}>
              Allow Buyer Messages
            </span>
            <span className="mt-0.5 block text-xs text-[var(--color-text)]">
              Shoppers can ask about a listing before they buy.
            </span>
          </span>
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={acceptMessagesForListings}
            onChange={(e) => setAcceptMessagesForListings(e.target.checked)}
          />
        </label>
      </section>

      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 rounded-lg bg-[var(--color-earth)] px-5 py-3 text-base font-bold text-white hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Seller Page"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border-2 border-[var(--color-earth)] bg-white px-5 py-3 text-base font-bold text-[var(--color-earth)] hover:bg-[#FFF8E1]"
        >
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
          <div className="relative z-10 w-full max-w-md rounded-xl border-2 bg-white p-6 shadow-xl text-center border-[var(--color-earth)]">
            <h3
              id="seller-page-saved-title"
              className="text-lg font-bold mb-5"
              style={{ color: "var(--color-heading)" }}
            >
              Your seller page is live.
            </h3>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                className="w-full rounded-lg bg-[var(--color-earth)] px-5 py-3 font-bold text-white"
                onClick={() => router.push("/seller-hub")}
              >
                Return to Seller Hub
              </button>
              {sellerSlug ? (
                <a
                  href={`/support-local/sellers/${sellerSlug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full items-center justify-center rounded-lg border-2 border-[var(--color-earth)] px-5 py-3 font-bold text-[var(--color-earth)]"
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
