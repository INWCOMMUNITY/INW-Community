"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type HoursRecord = Partial<Record<(typeof DAYS)[number], string>>;

interface SponsorOption {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
  businessCount: number;
}

interface BusinessExisting {
  id: string;
  name: string;
  shortDescription: string | null;
  fullDescription: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  photos: string[];
  hoursOfOperation: unknown;
}

interface AdminBusinessFormProps {
  sponsors: SponsorOption[];
  existing?: BusinessExisting;
  onClose: () => void;
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

export function AdminBusinessForm({ sponsors, existing, onClose }: AdminBusinessFormProps) {
  const router = useRouter();
  const [memberId, setMemberId] = useState(existing ? "" : (sponsors[0]?.memberId ?? ""));
  const [name, setName] = useState(existing?.name ?? "");
  const [shortDescription, setShortDescription] = useState(existing?.shortDescription ?? "");
  const [fullDescription, setFullDescription] = useState(existing?.fullDescription ?? "");
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [logoUrl, setLogoUrl] = useState(existing?.logoUrl ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [city, setCity] = useState(existing?.city ?? "");
  const [categories, setCategories] = useState<string[]>(() => {
    const cats = existing?.categories ?? [];
    if (cats.length === 0) return [""];
    if (cats.length === 1) return [cats[0], ""];
    return cats.slice(0, 2);
  });
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [hours, setHours] = useState<HoursRecord>(() => parseHours(existing?.hoursOfOperation ?? null));
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const adminHeaders = {
    "Content-Type": "application/json",
    "x-admin-code": ADMIN_CODE,
  };

  async function uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${MAIN_URL}/api/admin/upload`, {
      method: "POST",
      headers: { "x-admin-code": ADMIN_CODE },
      body: formData,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    const url = data.url;
    if (!url) throw new Error("No URL returned");
    if (url.startsWith("/")) return `${MAIN_URL}${url}`;
    return url;
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
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

  async function handlePhotosChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;
    setUploadingPhotos(true);
    setError("");
    try {
      for (let i = 0; i < files.length; i++) {
        const url = await uploadFile(files[i]);
        setPhotos((prev) => (prev.includes(url) ? prev : [...prev, url]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setUploadingPhotos(false);
      e.target.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cats = categories.filter((c) => c.trim()).slice(0, 2);
    if (cats.length === 0) {
      setError("At least one category is required.");
      return;
    }
    if (!existing && !memberId) {
      setError("Select a sponsor.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const body = {
        ...(existing ? {} : { memberId }),
        name,
        shortDescription: shortDescription || null,
        fullDescription: fullDescription || null,
        website: website || null,
        phone: phone || null,
        email: email || null,
        logoUrl: logoUrl || null,
        address: address || null,
        city: city || null,
        categories: cats,
        photos,
        hoursOfOperation: (() => {
          const filtered = Object.fromEntries(
            Object.entries(hours).filter(([, v]) => typeof v === "string" && v.trim() !== "")
          );
          return Object.keys(filtered).length ? filtered : null;
        })(),
      };
      const url = existing ? `${MAIN_URL}/api/admin/businesses/${existing.id}` : `${MAIN_URL}/api/admin/businesses`;
      const method = existing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: adminHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to save.");
        return;
      }
      onClose();
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl max-h-[85vh] overflow-y-auto p-4">
      {!existing && sponsors.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">Sponsor (member) *</label>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          >
            <option value="">Select sponsor…</option>
            {sponsors.filter((s) => s.businessCount < 2).map((s) => (
              <option key={s.memberId} value={s.memberId}>
                {s.firstName} {s.lastName} ({s.email}) – {s.businessCount}/2 businesses
              </option>
            ))}
          </select>
        </div>
      )}
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
        <textarea value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} rows={2} required className="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Full description *</label>
        <textarea value={fullDescription} onChange={(e) => setFullDescription(e.target.value)} rows={4} required className="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Website (optional)</label>
        <input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} className="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Phone (optional)</label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Email (optional)</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Logo *</label>
        <div className="flex items-center gap-4">
          {logoUrl && (
            <div className="relative">
              <img src={logoUrl} alt="Logo preview" className="w-20 h-20 object-contain border rounded" />
              <button type="button" onClick={() => setLogoUrl("")} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs leading-none" aria-label="Remove logo">
                ×
              </button>
            </div>
          )}
          <label className="cursor-pointer">
            <span className="inline-block px-4 py-2 border rounded hover:bg-gray-100">{uploadingLogo ? "Uploading…" : logoUrl ? "Change logo" : "Upload logo"}</span>
            <input type="file" accept="image/*" onChange={handleLogoChange} disabled={uploadingLogo} className="sr-only" />
          </label>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Address *</label>
        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} required className="w-full border rounded px-3 py-2" placeholder="e.g. 123 Main St, Coeur d'Alene, ID 83815" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">City *</label>
        <input type="text" value={city} onChange={(e) => setCity(e.target.value)} required className="w-full border rounded px-3 py-2" placeholder="e.g. Coeur d'Alene" />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Business categories (up to 2) *</label>
        {[0, 1].map((i) => (
          <input
            key={i}
            type="text"
            value={categories[i] ?? ""}
            onChange={(e) => {
              const next = [...categories];
              next[i] = e.target.value;
              if (i === 0 && next.length === 1 && e.target.value) next.push("");
              setCategories(next.slice(0, 2));
            }}
            required={i === 0}
            placeholder={i === 0 ? "e.g. Retail" : "e.g. Marketing (optional)"}
            className="w-full border rounded px-3 py-2 mt-1"
          />
        ))}
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Hours of operation</label>
        <div className="grid gap-y-2 gap-x-6 sm:grid-cols-2">
          {DAYS.map((day) => (
            <div key={day} className="flex items-center gap-2">
              <label className="w-24 capitalize text-sm shrink-0">{day}</label>
              <input
                type="text"
                value={hours[day] ?? ""}
                onChange={(e) => setHours((h) => ({ ...h, [day]: e.target.value }))}
                placeholder="9:00 AM - 5:00 PM"
                className="flex-1 border rounded px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Photos (optional)</label>
        <label className="cursor-pointer inline-block">
          <span className="inline-block px-4 py-2 border rounded hover:bg-gray-100">{uploadingPhotos ? "Uploading…" : "Upload photos"}</span>
          <input type="file" accept="image/*" multiple onChange={handlePhotosChange} disabled={uploadingPhotos} className="sr-only" />
        </label>
        {photos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {photos.map((url, i) => (
              <div key={url} className="relative shrink-0 w-16 h-16 rounded border">
                <img src={url} alt="" className="w-full h-full object-cover rounded" />
                <button type="button" onClick={() => setPhotos(photos.filter((_, idx) => idx !== i))} className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="px-4 py-2 rounded disabled:opacity-50" style={{ backgroundColor: "#505542", color: "#fff" }} disabled={submitting}>
          {submitting ? "Saving…" : existing ? "Update business" : "Add business"}
        </button>
        <button type="button" onClick={onClose} className="px-4 py-2 border rounded hover:bg-gray-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
