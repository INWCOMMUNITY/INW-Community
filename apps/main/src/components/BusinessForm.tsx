"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";
import { CityPicker } from "@/components/CityPicker";
import { AddressSearchInput, type AddressValue } from "@/components/AddressSearchInput";
import { normalizeResidentCity } from "@/lib/city-utils";
import {
  BUSINESS_CATEGORIES,
  getSubcategoriesForBusinessCategory,
  normalizeSubcategoriesByPrimary,
  parseSubcategoriesByPrimary,
  sellerSignupCategories,
  type BusinessCategoryOption,
} from "@/lib/business-categories";
import { BusinessCategoryPrimaryPicker } from "@/components/BusinessCategoryPrimaryPicker";
import { ListingFormSection } from "@/components/store-item/ListingFormSection";
import { ListingPhotoGallery } from "@/components/store-item/ListingPhotoGallery";
import { MAX_BUSINESS_GALLERY_PHOTOS, formatListingPhotoSizeLabel } from "@/lib/upload-limits";
import { uploadBusinessPhoto } from "@/lib/upload-listing-photo-browser";
import type { Business } from "database";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function emptyStorefrontAddress(): AddressValue {
  return { street: "", aptOrSuite: "", city: "", state: "", zip: "" };
}

function parseStoredStorefrontAddress(raw: string): AddressValue {
  const trimmed = raw.trim();
  if (!trimmed) return emptyStorefrontAddress();
  const match = trimmed.match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!match) return { ...emptyStorefrontAddress(), street: trimmed };
  return {
    street: match[1].trim(),
    aptOrSuite: "",
    city: match[2].trim(),
    state: match[3].trim().toUpperCase(),
    zip: match[4].trim(),
  };
}

function formatStorefrontAddress(addr: AddressValue): string {
  const street = [addr.street.trim(), addr.aptOrSuite?.trim()].filter(Boolean).join(", ");
  const region = [addr.state.trim(), addr.zip.trim()].filter(Boolean).join(" ");
  return [street, addr.city.trim(), region].filter(Boolean).join(", ");
}
type HoursRecord = Partial<Record<(typeof DAYS)[number], string>>;

export type BusinessFormData = {
  name: string;
  shortDescription: string | null;
  fullDescription: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  coverPhotoUrl?: string | null;
  address: string | null;
  city: string;
  categories: string[];
  subcategoriesByPrimary?: Record<string, string[]>;
  photos: string[];
  hoursOfOperation?: Record<string, string> | null;
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
};

interface BusinessFormProps {
  existing?: Pick<
    Business,
    "id" | "name" | "shortDescription" | "fullDescription" | "website" | "phone" | "email" | "logoUrl" | "coverPhotoUrl" | "address" | "city" | "categories" | "subcategoriesByPrimary" | "photos" | "hoursOfOperation" | "facebookUrl" | "instagramUrl" | "tiktokUrl"
  >;
  /** When "signup", form calls onDataReady instead of POSTing; used in signup flow */
  mode?: "edit" | "signup";
  onDataReady?: (data: BusinessFormData) => void;
  /** When provided, called after successful save instead of navigating to /business-hub/business */
  onSuccess?: () => void;
  /** Seller signup leads with shop categories. Directory signup keeps the local-business order. */
  categoryCatalog?: "directory" | "seller";
  /** Signup pages place Back beside Continue. */
  onBack?: () => void;
}

function StorefrontImageField({
  title,
  hint,
  imageUrl,
  uploading,
  onFile,
  onClear,
  frameClass,
  error,
}: {
  title: string;
  hint: string;
  imageUrl: string;
  uploading: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
  frameClass: string;
  error?: string;
}) {
  const [dragOver, setDragOver] = useState(false);

  function takeFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) onFile(file);
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-gray-500 mt-1">{hint}</p>
      </div>
      {imageUrl ? (
        <div className={`relative w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50 ${frameClass}`}>
          <img src={imageUrl} alt="" className="h-full w-full object-contain" />
          <button
            type="button"
            onClick={onClear}
            className="absolute right-2 top-2 z-10 h-6 w-6 rounded-full bg-red-500 text-sm leading-none text-white hover:bg-red-600"
            aria-label={`Remove ${title}`}
          >
            ×
          </button>
        </div>
      ) : null}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          takeFiles(e.dataTransfer.files);
        }}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragOver
            ? "border-[var(--color-primary)] bg-[var(--color-primary)]/5"
            : "border-gray-300 bg-gray-50/50 hover:border-gray-400"
        }`}
      >
        <p className="mb-1 text-sm font-medium text-gray-800">{imageUrl ? `Change ${title}` : `Add ${title}`}</p>
        <p className="mb-3 text-xs text-gray-500">
          Drag and drop or choose from your device. Up to {formatListingPhotoSizeLabel()}; large photos are resized automatically.
        </p>
        <label className="inline-block cursor-pointer">
          <span className="action-pill action-pill-sm btn-pill-primary">{uploading ? "Uploading…" : "Choose Photo"}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/*"
            disabled={uploading}
            onChange={(e) => {
              takeFiles(e.target.files);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function parseHours(ho: unknown): HoursRecord {
  if (!ho || typeof ho !== "object") return {};
  const r: HoursRecord = {};
  for (const d of DAYS) {
    const v = (ho as Record<string, unknown>)[d];
    if (typeof v === "string") r[d] = v;
  }
  return r;
}

function SubcategoryCustomRow({
  onAdd,
}: {
  onAdd: (text: string) => void;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const t = val.trim();
            if (t) {
              onAdd(t);
              setVal("");
            }
          }
        }}
        placeholder="Add custom subcategory (Enter)"
        className="flex-1 border rounded px-2 py-1 text-sm bg-white"
      />
    </div>
  );
}

export function BusinessForm({
  existing,
  mode = "edit",
  onDataReady,
  onSuccess,
  categoryCatalog = "directory",
  onBack,
}: BusinessFormProps) {
  const categoryPresets: BusinessCategoryOption[] =
    categoryCatalog === "seller" ? sellerSignupCategories() : BUSINESS_CATEGORIES;
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [shortDescription, setShortDescription] = useState(existing?.shortDescription ?? "");
  const [fullDescription, setFullDescription] = useState(existing?.fullDescription ?? "");
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [facebookUrl, setFacebookUrl] = useState(existing?.facebookUrl ?? "");
  const [instagramUrl, setInstagramUrl] = useState(existing?.instagramUrl ?? "");
  const [tiktokUrl, setTiktokUrl] = useState(existing?.tiktokUrl ?? "");
  const [logoUrl, setLogoUrl] = useState(existing?.logoUrl ?? "");
  const [coverPhotoUrl, setCoverPhotoUrl] = useState("coverPhotoUrl" in (existing ?? {}) ? (existing as { coverPhotoUrl?: string }).coverPhotoUrl ?? "" : "");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [address, setAddress] = useState("address" in (existing ?? {}) ? (existing as { address?: string }).address ?? "" : "");
  const [storefrontAddress, setStorefrontAddress] = useState<AddressValue>(() =>
    parseStoredStorefrontAddress("address" in (existing ?? {}) ? (existing as { address?: string }).address ?? "" : "")
  );
  const [addressNotApplicable, setAddressNotApplicable] = useState(false);
  const [city, setCity] = useState(existing?.city ?? "");
  const [categories, setCategories] = useState<string[]>(() => {
    const cats = existing?.categories ?? [];
    if (cats.length === 0) return [""];
    if (cats.length === 1) return [cats[0], ""];
    return cats.slice(0, 2);
  });
  const [subsPerSlot, setSubsPerSlot] = useState<string[][]>(() => {
    const map = parseSubcategoriesByPrimary(
      (existing as { subcategoriesByPrimary?: unknown } | undefined)?.subcategoriesByPrimary
    );
    const cats = existing?.categories ?? [];
    const p0 = (cats[0] ?? "").trim();
    const p1 = (cats[1] ?? "").trim();
    return [
      p0 ? [...(map[p0] ?? [])] : [],
      p1 ? [...(map[p1] ?? [])] : [],
    ];
  });
  const primaryCommittedRef = useRef<[string, string]>(["", ""]);
  useEffect(() => {
    const c = existing?.categories ?? [];
    primaryCommittedRef.current = [(c[0] ?? "").trim(), (c[1] ?? "").trim()];
  }, [existing?.id]);

  function toggleSubSlot(slotIdx: number, sub: string) {
    const t = sub.trim();
    if (!t) return;
    setSubsPerSlot((prev) => {
      const next = prev.map((arr) => [...arr]);
      const list = next[slotIdx] ?? [];
      const j = list.indexOf(t);
      if (j >= 0) next[slotIdx] = list.filter((_, k) => k !== j);
      else next[slotIdx] = [...list, t];
      return next;
    });
  }

  function addCustomSubSlot(slotIdx: number, raw: string) {
    const t = raw.trim();
    if (!t) return;
    setSubsPerSlot((prev) => {
      const next = prev.map((arr) => [...arr]);
      const list = next[slotIdx] ?? [];
      if (!list.includes(t)) next[slotIdx] = [...list, t];
      return next;
    });
  }
  const [photos, setPhotos] = useState<string[]>(
    () => (existing?.photos ?? []).slice(0, MAX_BUSINESS_GALLERY_PHOTOS)
  );
  const [hours, setHours] = useState<HoursRecord>(() => parseHours(existing?.hoursOfOperation ?? null));
  const [hoursNotApplicable, setHoursNotApplicable] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [coverError, setCoverError] = useState("");
  const [photoError, setPhotoError] = useState("");

  function uploadFailureMessage(err: unknown, fallback: string) {
    return err instanceof Error && err.message ? err.message : fallback;
  }

  async function uploadLogoFile(file: File) {
    setUploadingLogo(true);
    setLogoError("");
    try {
      const url = await uploadBusinessPhoto(file, { logo: true });
      setLogoUrl(url);
    } catch (err) {
      setLogoError(uploadFailureMessage(err, "Logo upload failed"));
    } finally {
      setUploadingLogo(false);
    }
  }

  async function uploadCoverFile(file: File) {
    setUploadingCover(true);
    setCoverError("");
    try {
      const url = await uploadBusinessPhoto(file);
      setCoverPhotoUrl(url);
    } catch (err) {
      setCoverError(uploadFailureMessage(err, "Cover upload failed"));
    } finally {
      setUploadingCover(false);
    }
  }

  async function uploadGalleryFiles(files: File[]) {
    const remaining = MAX_BUSINESS_GALLERY_PHOTOS - photos.length;
    if (remaining <= 0) {
      setPhotoError(`Maximum ${MAX_BUSINESS_GALLERY_PHOTOS} photos. Remove one to add another.`);
      return;
    }
    setUploadingPhotos(true);
    setPhotoError("");
    const list = files.slice(0, remaining);
    let added = 0;
    let lastErr = "";
    try {
      for (const file of list) {
        try {
          const url = await uploadBusinessPhoto(file);
          setPhotos((prev) => {
            if (prev.length >= MAX_BUSINESS_GALLERY_PHOTOS) return prev;
            return prev.includes(url) ? prev : [...prev, url];
          });
          added += 1;
        } catch (err) {
          lastErr = uploadFailureMessage(err, "Business photo upload failed");
        }
      }
      if (files.length > remaining) {
        lastErr = `Only ${MAX_BUSINESS_GALLERY_PHOTOS} photos can be added.`;
      }
      if (added < list.length && lastErr) {
        setPhotoError(added > 0 ? `Uploaded ${added} of ${list.length}. ${lastErr}` : lastErr);
      }
    } finally {
      setUploadingPhotos(false);
    }
  }

  function buildFormData() {
    const cats = categories.filter((c) => c.trim()).slice(0, 2);
    const hoursFiltered = Object.fromEntries(
      Object.entries(hours).filter(([, v]) => typeof v === "string" && v.trim() !== "")
    );
    const map: Record<string, string[]> = {};
    cats.forEach((c, i) => {
      const list = (subsPerSlot[i] ?? []).map((s) => s.trim()).filter(Boolean);
      if (list.length) map[c] = [...new Set(list)];
    });
    return {
      name: name.trim(),
      shortDescription: shortDescription?.trim() || null,
      fullDescription: fullDescription?.trim() || null,
      website: website?.trim() || null,
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      logoUrl: logoUrl?.trim() || null,
      coverPhotoUrl: coverPhotoUrl?.trim() || null,
      address: addressNotApplicable ? null : address?.trim() || null,
      city: city.trim(),
      categories: cats,
      subcategoriesByPrimary: normalizeSubcategoriesByPrimary(cats, map),
      photos: photos.slice(0, MAX_BUSINESS_GALLERY_PHOTOS),
      hoursOfOperation: hoursNotApplicable || Object.keys(hoursFiltered).length === 0 ? null : hoursFiltered,
      facebookUrl: facebookUrl?.trim() || null,
      instagramUrl: instagramUrl?.trim() || null,
      tiktokUrl: tiktokUrl?.trim() || null,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cats = categories.filter((c) => c.trim()).slice(0, 2);
    if (cats.length === 0) {
      setError("At least one category is required.");
      return;
    }
    if (!name.trim() || !city.trim()) {
      setError("Company name and city are required.");
      return;
    }
    setError("");
    if (mode === "signup" && onDataReady) {
      onDataReady(buildFormData());
      return;
    }
    setSubmitting(true);
    try {
      const formData = buildFormData();
      const res = await fetch(existing ? `/api/businesses/${existing.id}` : "/api/businesses", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to save."));
        return;
      }
      if (onSuccess) onSuccess();
      else router.push("/business-hub/business");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ListingFormSection title="Photos" description="Logo, cover, and shop photos. The first shop photo is the main image.">
      <StorefrontImageField
        title="Logo"
        hint="Required. Shown on your storefront and in the directory."
        imageUrl={logoUrl}
        uploading={uploadingLogo}
        onFile={(file) => void uploadLogoFile(file)}
        onClear={() => {
          setLogoUrl("");
          setLogoError("");
        }}
        frameClass="aspect-square max-h-80"
        error={logoError}
      />
      <StorefrontImageField
        title="Cover Photo"
        hint="Optional. Wide backdrop for your seller storefront. Recommended 820×312 px."
        imageUrl={coverPhotoUrl}
        uploading={uploadingCover}
        onFile={(file) => void uploadCoverFile(file)}
        onClear={() => {
          setCoverPhotoUrl("");
          setCoverError("");
        }}
        frameClass="aspect-[2.6/1] max-h-56"
        error={coverError}
      />
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Business Photos</p>
          <p className="mt-1 text-xs text-gray-500">
            Optional. Up to {MAX_BUSINESS_GALLERY_PHOTOS} photos. The first photo is the main image.
          </p>
        </div>
        <ListingPhotoGallery
          photos={photos}
          onPhotosChange={(next) => setPhotos(next.slice(0, MAX_BUSINESS_GALLERY_PHOTOS))}
          onUploadFiles={uploadGalleryFiles}
          uploadingPhotos={uploadingPhotos}
          photoError={photoError}
          emptyTitle="Add Business Photos"
          moreTitle="Add More Business Photos"
          helperText={`Drag and drop or choose from your device. Up to ${MAX_BUSINESS_GALLERY_PHOTOS} photos, ${formatListingPhotoSizeLabel()} each. Large photos are resized automatically.`}
        />
      </div>
      </ListingFormSection>
      <ListingFormSection title="Business details" description="The name and story shoppers see on your storefront.">
      <div>
        <label className="block text-sm font-medium mb-1">Company Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Brief Description *</label>
        <textarea
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
          rows={2}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Full Description *</label>
        <textarea
          value={fullDescription}
          onChange={(e) => setFullDescription(e.target.value)}
          rows={4}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Website (optional)</label>
        <input
          type="url"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Phone (optional)</label>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Email (optional)</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div className="border-t pt-4 mt-4">
        <p className="text-sm font-medium mb-3">Social Media (optional)</p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Facebook URL</label>
            <input
              type="url"
              value={facebookUrl}
              onChange={(e) => setFacebookUrl(e.target.value)}
              placeholder="https://facebook.com/yourbusiness"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Instagram URL</label>
            <input
              type="url"
              value={instagramUrl}
              onChange={(e) => setInstagramUrl(e.target.value)}
              placeholder="https://instagram.com/yourbusiness"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">TikTok URL</label>
            <input
              type="url"
              value={tiktokUrl}
              onChange={(e) => setTiktokUrl(e.target.value)}
              placeholder="https://tiktok.com/@yourbusiness"
              className="w-full border rounded px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>
      </ListingFormSection>
      <ListingFormSection title="Location" description="City is required. A storefront address is optional.">
      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <label className="text-sm font-medium">Storefront Address</label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={addressNotApplicable}
              onChange={(e) => setAddressNotApplicable(e.target.checked)}
            />
            Not applicable
          </label>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          Don&apos;t put a personal address here. Add this only if you have a storefront.
        </p>
        {addressNotApplicable ? null : (
          <>
            <AddressSearchInput
              value={storefrontAddress}
              onChange={(addr) => {
                setStorefrontAddress(addr);
                setAddress(formatStorefrontAddress(addr));
                if (addr.city.trim()) setCity(normalizeResidentCity(addr.city));
              }}
              placeholder="Search for your storefront address"
            />
            <p className="text-xs text-gray-500 mt-1">
              Your storefront address will open in Google Maps or Apple Maps on your business page.
            </p>
          </>
        )}
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">City *</label>
        <CityPicker
          value={city}
          onChange={setCity}
          required
          placeholder="Search or select city (e.g. Coeur d'Alene)"
          className="w-full border rounded px-3 py-2"
        />
      </div>
      </ListingFormSection>
      <ListingFormSection title="Categories" description="Pick up to two. Use the list or add your own.">
      <div>
        <label className="block text-sm font-medium mb-1">Business categories (up to 2) *</label>
        <p className="text-xs text-gray-500 mb-2">
          Primary categories (from our list or custom). Under each primary you can select multiple subcategories or add your own.
        </p>
        {[0, 1].map((i) => {
          const primaryTrim = (categories[i] ?? "").trim();
          const preset = primaryTrim ? getSubcategoriesForBusinessCategory(primaryTrim) : [];
          const selected = subsPerSlot[i] ?? [];
          return (
            <div key={i} className="mt-3 space-y-2 border rounded p-3 bg-gray-50/50">
              <BusinessCategoryPrimaryPicker
                value={categories[i] ?? ""}
                onChange={(v) => {
                  const next = [...categories];
                  next[i] = v;
                  if (i === 0 && next.length === 1 && v.trim()) next.push("");
                  setCategories(next.slice(0, 2));
                  primaryCommittedRef.current[i] = v.trim();
                  setSubsPerSlot((sp) => {
                    const n = sp.map((a) => [...a]);
                    n[i] = [];
                    return n;
                  });
                }}
                shortDescription={shortDescription}
                fullDescription={fullDescription}
                presets={categoryPresets}
                required={i === 0}
                placeholder="Search categories…"
              />
              {primaryTrim ? (
                <div className="space-y-2">
                  {preset.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {preset.map((s) => {
                        const on = selected.includes(s);
                        return (
                          <button
                            key={s}
                            type="button"
                            onClick={() => toggleSubSlot(i, s)}
                            className={`text-xs px-2 py-1 rounded border transition-colors ${
                              on ? "bg-[var(--color-primary)] text-white border-[var(--color-primary)]" : "bg-white border-gray-300 hover:bg-gray-100"
                            }`}
                          >
                            {s}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <SubcategoryCustomRow
                    key={`${i}-${primaryTrim}`}
                    onAdd={(text) => addCustomSubSlot(i, text)}
                  />
                  {selected.length > 0 ? (
                    <p className="text-xs text-gray-600">
                      Selected:{" "}
                      {selected.map((s) => (
                        <span key={s} className="inline-flex items-center gap-1 mr-2">
                          {s}
                          <button
                            type="button"
                            className="text-red-600 hover:underline"
                            onClick={() => toggleSubSlot(i, s)}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      </ListingFormSection>
      <ListingFormSection title="Hours" description="Add your open hours, or mark them not applicable.">
      <div>
        <div className="mb-1 flex items-center justify-between gap-3">
          <label className="text-sm font-medium">Hours of Operation</label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hoursNotApplicable}
              onChange={(e) => setHoursNotApplicable(e.target.checked)}
            />
            Not applicable
          </label>
        </div>
        {hoursNotApplicable ? null : (
          <>
        <p className="text-xs text-gray-500 mb-2">Enter hours for each day, e.g. 9:00 AM - 5:00 PM or CLOSED</p>
        <div className="grid gap-y-2 gap-x-1 sm:grid-cols-2">
          {DAYS.map((day) => (
            <div key={day} className="flex items-center gap-1">
              <label className="w-20 capitalize text-sm shrink-0">{day}</label>
              <input
                type="text"
                value={hours[day] ?? ""}
                onChange={(e) => setHours((h) => ({ ...h, [day]: e.target.value }))}
                placeholder="9:00 AM - 5:00 PM"
                className="min-w-[140px] w-full max-w-[180px] border rounded px-2 py-2 text-sm"
              />
            </div>
          ))}
        </div>
          </>
        )}
      </div>
      </ListingFormSection>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-2">
        {onBack ? (
          <button type="button" onClick={onBack} className="btn-outline flex-1 text-center">
            Back
          </button>
        ) : null}
        <button type="submit" className={`btn text-center ${onBack ? "flex-1" : ""}`} disabled={submitting}>
          {mode === "signup" ? "Continue" : submitting ? "Saving…" : existing ? "Update Business" : "Add Business"}
        </button>
      </div>
    </form>
  );
}
