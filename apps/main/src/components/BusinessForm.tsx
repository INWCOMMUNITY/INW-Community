"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { BadgeEarnedStackOverlay, type EarnedBadgeForOverlay } from "@/components/BadgeEarnedStackOverlay";
import { CityPicker } from "@/components/CityPicker";
import {
  BUSINESS_CATEGORIES,
  getSubcategoriesForBusinessCategory,
  normalizeSubcategoriesByPrimary,
  parseSubcategoriesByPrimary,
} from "@/lib/business-categories";
import { BusinessCategoryPrimaryPicker } from "@/components/BusinessCategoryPrimaryPicker";
import {
  MAX_BUSINESS_GALLERY_PHOTOS,
  MAX_UPLOAD_FILE_BYTES,
  formatMaxUploadSizeLabel,
} from "@/lib/upload-limits";
import type { Business } from "database";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
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
};

interface BusinessFormProps {
  existing?: Pick<
    Business,
    "id" | "name" | "shortDescription" | "fullDescription" | "website" | "phone" | "email" | "logoUrl" | "coverPhotoUrl" | "address" | "city" | "categories" | "subcategoriesByPrimary" | "photos" | "hoursOfOperation"
  >;
  /** When "signup", form calls onDataReady instead of POSTing; used in signup flow */
  mode?: "edit" | "signup";
  onDataReady?: (data: BusinessFormData) => void;
  /** When provided, called after successful save instead of navigating to /business-hub/business */
  onSuccess?: () => void;
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

export function BusinessForm({ existing, mode = "edit", onDataReady, onSuccess }: BusinessFormProps) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [shortDescription, setShortDescription] = useState(existing?.shortDescription ?? "");
  const [fullDescription, setFullDescription] = useState(existing?.fullDescription ?? "");
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [logoUrl, setLogoUrl] = useState(existing?.logoUrl ?? "");
  const [coverPhotoUrl, setCoverPhotoUrl] = useState("coverPhotoUrl" in (existing ?? {}) ? (existing as { coverPhotoUrl?: string }).coverPhotoUrl ?? "" : "");
  const [uploadingCover, setUploadingCover] = useState(false);
  const [postEarnedBadges, setPostEarnedBadges] = useState<EarnedBadgeForOverlay[]>([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);
  const [address, setAddress] = useState("address" in (existing ?? {}) ? (existing as { address?: string }).address ?? "" : "");
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
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useLockBodyScroll(badgePopupIndex >= 0);

  function finishAfterBusinessBadges() {
    setPostEarnedBadges([]);
    setBadgePopupIndex(-1);
    if (onSuccess) onSuccess();
    else router.push("/business-hub/business");
    router.refresh();
  }

  function handleCloseBusinessBadgePopup() {
    if (badgePopupIndex >= 0 && badgePopupIndex < postEarnedBadges.length - 1) {
      setBadgePopupIndex((i) => i + 1);
    } else {
      finishAfterBusinessBadges();
    }
  }

  async function uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    const url = data.url;
    if (!url) throw new Error("No URL returned");
    if (url.startsWith("/")) return `${window.location.origin}${url}`;
    return url;
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      setError(`Image is too large (max ${formatMaxUploadSizeLabel()}).`);
      e.target.value = "";
      return;
    }
    setUploadingLogo(true);
    try {
      const url = await uploadFile(file);
      setLogoUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Logo upload failed");
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  }

  async function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingCover(true);
    try {
      const url = await uploadFile(file);
      setCoverPhotoUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cover upload failed");
    } finally {
      setUploadingCover(false);
      e.target.value = "";
    }
  }

  async function handlePhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    const remaining = MAX_BUSINESS_GALLERY_PHOTOS - photos.length;
    if (remaining <= 0) {
      setError(`Maximum ${MAX_BUSINESS_GALLERY_PHOTOS} gallery photos. Remove one to add another.`);
      e.target.value = "";
      return;
    }
    setUploadingPhotos(true);
    setError("");
    const list = Array.from(files).slice(0, remaining);
    let added = 0;
    let lastErr = "";
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i];
        if (file.size > MAX_UPLOAD_FILE_BYTES) {
          lastErr = `A photo exceeds ${formatMaxUploadSizeLabel()}.`;
          continue;
        }
        try {
          const url = await uploadFile(file);
          setPhotos((prev) => {
            if (prev.length >= MAX_BUSINESS_GALLERY_PHOTOS) return prev;
            return prev.includes(url) ? prev : [...prev, url];
          });
          added += 1;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : "Photo upload failed";
        }
      }
      if (added < list.length && lastErr) {
        setError(added > 0 ? `Uploaded ${added} of ${list.length}. ${lastErr}` : lastErr);
      }
    } finally {
      setUploadingPhotos(false);
      e.target.value = "";
    }
  }

  function removePhoto(i: number) {
    setPhotos(photos.filter((_, idx) => idx !== i));
  }

  function movePhoto(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
  }

  function handleDragEnd() {
    setDragIndex(null);
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
      address: address?.trim() || null,
      city: city.trim(),
      categories: cats,
      subcategoriesByPrimary: normalizeSubcategoriesByPrimary(cats, map),
      photos: photos.slice(0, MAX_BUSINESS_GALLERY_PHOTOS),
      hoursOfOperation: Object.keys(hoursFiltered).length ? hoursFiltered : null,
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
      if (!existing) {
        const badges = Array.isArray(data.earnedBadges)
          ? (data.earnedBadges as EarnedBadgeForOverlay[]).filter((b) => b?.slug && b?.name)
          : [];
        if (badges.length > 0) {
          setPostEarnedBadges(badges);
          setBadgePopupIndex(0);
          return;
        }
      }
      if (onSuccess) onSuccess();
      else router.push("/business-hub/business");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const activePostBadge =
    badgePopupIndex >= 0 && badgePopupIndex < postEarnedBadges.length
      ? postEarnedBadges[badgePopupIndex]
      : null;

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-1">Company name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Brief description *</label>
        <textarea
          value={shortDescription}
          onChange={(e) => setShortDescription(e.target.value)}
          rows={2}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Full description *</label>
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
      <div>
        <label className="block text-sm font-medium mb-1">Logo *</label>
        <div className="flex items-center gap-4">
          {logoUrl && (
            <div className="relative">
              <img src={logoUrl} alt="Logo preview" className="w-20 h-20 object-contain border rounded" />
              <button
                type="button"
                onClick={() => setLogoUrl("")}
                className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none"
                aria-label="Remove logo"
              >
                ×
              </button>
            </div>
          )}
          <label className="cursor-pointer">
            <span className="inline-block px-4 py-2 border rounded hover:bg-gray-100">
              {uploadingLogo ? "Uploading…" : logoUrl ? "Change logo" : "Upload logo"}
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoChange}
              disabled={uploadingLogo}
              className="sr-only"
            />
          </label>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          Upload from your device or camera. Max {formatMaxUploadSizeLabel()}. JPEG, PNG, WebP, GIF.
        </p>
      </div>
      {existing && (
        <div>
          <label className="block text-sm font-medium mb-1">Storefront cover photo (optional)</label>
          <p className="text-xs text-gray-500 mb-2">Facebook-style backdrop for your seller storefront page. Recommended 820×312 px.</p>
          <div className="flex items-center gap-4">
            {coverPhotoUrl && (
              <div className="relative">
                <img src={coverPhotoUrl} alt="Cover preview" className="w-40 h-24 object-cover border rounded" />
                <button
                  type="button"
                  onClick={() => setCoverPhotoUrl("")}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none"
                  aria-label="Remove cover"
                >
                  ×
                </button>
              </div>
            )}
            <label className="cursor-pointer">
              <span className="inline-block px-4 py-2 border rounded hover:bg-gray-100">
                {uploadingCover ? "Uploading…" : coverPhotoUrl ? "Change cover" : "Upload cover"}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleCoverChange}
                disabled={uploadingCover}
                className="sr-only"
              />
            </label>
          </div>
        </div>
      )}
      <div>
        <label className="block text-sm font-medium mb-1">Address *</label>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
          placeholder="e.g. 123 Main St, Coeur d'Alene, ID 83815"
        />
        <p className="text-xs text-gray-500 mt-1">
          Your address will open in Google Maps or Apple Maps on your business page.
        </p>
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
                presets={BUSINESS_CATEGORIES}
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
      <div>
        <label className="block text-sm font-medium mb-1">Hours of operation</label>
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
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Photos of your business (optional)</label>
        <label className="cursor-pointer inline-block">
          <span className="inline-block px-4 py-2 border rounded hover:bg-gray-100">
            {uploadingPhotos ? "Uploading…" : "Upload photos"}
          </span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotosChange}
            disabled={uploadingPhotos}
            className="sr-only"
          />
        </label>
        <p className="text-xs text-gray-500 mt-1">
          Up to {MAX_BUSINESS_GALLERY_PHOTOS} photos, {formatMaxUploadSizeLabel()} each. JPEG, PNG, WebP, GIF.
        </p>
        {photos.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {photos.map((url, i) => (
                <div
                  key={url}
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(i);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(i));
                    e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    if (!isNaN(fromIndex) && fromIndex !== i) {
                      movePhoto(fromIndex, i);
                    }
                    setDragIndex(null);
                  }}
                  onDragEnd={handleDragEnd}
                  className={`relative shrink-0 w-16 h-16 rounded border-2 cursor-grab active:cursor-grabbing select-none ${
                    dragIndex === i ? "opacity-50 border-red-500" : "border-gray-300"
                  }`}
                >
                  <img
                    src={url}
                    alt=""
                    className="w-full h-full object-cover rounded pointer-events-none"
                    draggable={false}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removePhoto(i);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs z-10"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">Drag thumbnails to reorder. First image is the main photo.</p>
          </div>
        )}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" className="btn" disabled={submitting}>
        {mode === "signup" ? "Continue" : submitting ? "Saving…" : existing ? "Update business" : "Add business"}
      </button>
    </form>
    <BadgeEarnedStackOverlay badge={activePostBadge} onDismiss={handleCloseBusinessBadgePopup} />
    </>
  );
}
