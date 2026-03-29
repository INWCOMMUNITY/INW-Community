"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_UPLOAD_FILE_BYTES, formatMaxUploadSizeLabel } from "@/lib/upload-limits";

function toYmdLocal(d: string | Date | null | undefined): string {
  if (d == null || d === "") return "";
  const x = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdLocalEndToIso(ymd: string): string | null {
  const t = ymd.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const d = parseInt(m[3], 10);
  const end = new Date(y, mo - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(end.getTime())) return null;
  if (end.getFullYear() !== y || end.getMonth() !== mo - 1 || end.getDate() !== d) return null;
  return end.toISOString();
}

function previewExpiresLine(
  ymdInput: string,
  expiresAt: string | Date | null | undefined
): string | null {
  const t = ymdInput.trim();
  if (t) {
    const iso = ymdLocalEndToIso(t);
    if (iso) {
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) {
        return `Offer ends ${d.toLocaleDateString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        })}`;
      }
    }
  }
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (!Number.isNaN(d.getTime())) {
      return `Offer ends ${d.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })}`;
    }
  }
  return null;
}

function absImageUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u.startsWith("http")) return u;
  if (typeof window === "undefined") return u;
  return `${window.location.origin}${u.startsWith("/") ? "" : "/"}${u}`;
}

type CouponRow = {
  id: string;
  name: string;
  discount: string;
  code: string;
  maxMonthlyUses: number;
  expiresAt?: string | Date | null;
  imageUrl?: string | null;
  secretKey?: string | null;
  business?: { id: string; name: string } | null;
};

function CouponEditCard({
  c,
  onMergeLocal,
  onSave,
  onDelete,
  savingId,
  deletingId,
}: {
  c: CouponRow;
  onMergeLocal: (id: string, patch: Partial<CouponRow>) => void;
  onSave: (id: string, patch: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => void;
  savingId: string | null;
  deletingId: string | null;
}) {
  const [name, setName] = useState(c.name);
  const [discount, setDiscount] = useState(c.discount);
  const [code, setCode] = useState(c.code);
  const [secretKey, setSecretKey] = useState(c.secretKey ?? "");
  const [maxMonthlyUses, setMaxMonthlyUses] = useState(String(c.maxMonthlyUses ?? 1));
  const [expiresYmd, setExpiresYmd] = useState(toYmdLocal(c.expiresAt));
  const [uploadingImage, setUploadingImage] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const busy = savingId === c.id || deletingId === c.id;

  useEffect(() => {
    setName(c.name);
    setDiscount(c.discount);
    setCode(c.code);
    setSecretKey(c.secretKey ?? "");
    setMaxMonthlyUses(String(c.maxMonthlyUses ?? 1));
    setExpiresYmd(toYmdLocal(c.expiresAt));
  }, [c]);

  const previewExpireLine = previewExpiresLine(expiresYmd, c.expiresAt);

  async function uploadPhoto(file: File): Promise<string> {
    if (file.size > MAX_UPLOAD_FILE_BYTES) {
      throw new Error(`Image is too large (max ${formatMaxUploadSizeLabel()}).`);
    }
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    const url = data.url as string | undefined;
    if (!url) throw new Error("No URL returned");
    if (url.startsWith("/")) return `${window.location.origin}${url}`;
    return url;
  }

  return (
    <div
      className="border rounded-xl p-4 space-y-3"
      style={{ borderColor: "var(--color-primary)" }}
    >
      <p className="font-bold text-base" style={{ color: "var(--color-heading)" }}>
        {c.business?.name ?? "—"}
      </p>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Coupons are for physical in-person use; online storefront redemption is not enabled yet.
      </div>

      <label className="block text-xs font-semibold text-gray-600">Name</label>
      <input
        className="w-full border rounded px-3 py-2 text-sm"
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const v = name.trim();
          if (v && v !== c.name) {
            onMergeLocal(c.id, { name: v });
            void onSave(c.id, { name: v });
          }
        }}
      />

      <label className="block text-xs font-semibold text-gray-600">Discount</label>
      <input
        className="w-full border rounded px-3 py-2 text-sm"
        value={discount}
        disabled={busy}
        onChange={(e) => setDiscount(e.target.value)}
        onBlur={() => {
          const v = discount.trim();
          if (v && v !== c.discount) {
            onMergeLocal(c.id, { discount: v });
            void onSave(c.id, { discount: v });
          }
        }}
      />

      <label className="block text-xs font-semibold text-gray-600">Redemption code</label>
      <p className="text-xs text-gray-500 -mt-1">The code customers show or enter in store.</p>
      <input
        className="w-full border rounded px-3 py-2 text-sm font-mono"
        value={code}
        disabled={busy}
        onChange={(e) => setCode(e.target.value)}
        onBlur={() => {
          const v = code.trim();
          if (v && v !== c.code) {
            onMergeLocal(c.id, { code: v });
            void onSave(c.id, { code: v });
          }
        }}
      />

      <label className="block text-xs font-semibold text-gray-600">Expires (optional)</label>
      <p className="text-xs text-gray-500 -mt-1">Last day in the coupon book; leave empty for no expiration.</p>
      <input
        type="date"
        className="w-full max-w-xs border rounded px-3 py-2 text-sm"
        value={expiresYmd}
        disabled={busy}
        onChange={(e) => setExpiresYmd(e.target.value)}
        onBlur={() => {
          const v = expiresYmd;
          const prevYmd = toYmdLocal(c.expiresAt);
          if (v === prevYmd) return;
          if (!v) {
            if (c.expiresAt != null) {
              onMergeLocal(c.id, { expiresAt: null });
              void onSave(c.id, { expiresAt: null });
            }
            return;
          }
          const iso = ymdLocalEndToIso(v);
          if (!iso) return;
          onMergeLocal(c.id, { expiresAt: iso });
          void onSave(c.id, { expiresAt: iso });
        }}
      />
      <button
        type="button"
        className="text-sm font-medium hover:underline disabled:opacity-50"
        style={{ color: "var(--color-primary)" }}
        disabled={busy || (c.expiresAt == null && !expiresYmd)}
        onClick={() => {
          setExpiresYmd("");
          if (c.expiresAt != null) {
            onMergeLocal(c.id, { expiresAt: null });
            void onSave(c.id, { expiresAt: null });
          }
        }}
      >
        Clear expiration
      </button>

      <label className="block text-xs font-semibold text-gray-600">Secret key</label>
      <p className="text-xs text-gray-500 -mt-1">
        Customers enter this when redeeming for points and tracking. Leave empty if you do not use redemption tracking.
      </p>
      <input
        className="w-full border rounded px-3 py-2 text-sm font-mono"
        value={secretKey}
        disabled={busy}
        autoComplete="off"
        onChange={(e) => setSecretKey(e.target.value)}
        onBlur={() => {
          const v = secretKey.trim();
          const cur = (c.secretKey ?? "").trim();
          if (v === cur) return;
          onMergeLocal(c.id, { secretKey: v || null });
          void onSave(c.id, { secretKey: v || null });
        }}
      />

      <label className="block text-xs font-semibold text-gray-600">Max uses per month</label>
      <input
        type="number"
        min={1}
        className="w-28 border rounded px-3 py-2 text-sm"
        value={maxMonthlyUses}
        disabled={busy}
        onChange={(e) => setMaxMonthlyUses(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => {
          const n = parseInt(maxMonthlyUses, 10);
          if (!Number.isFinite(n) || n < 1) {
            setMaxMonthlyUses(String(c.maxMonthlyUses ?? 1));
            return;
          }
          if (n !== c.maxMonthlyUses) {
            onMergeLocal(c.id, { maxMonthlyUses: n });
            void onSave(c.id, { maxMonthlyUses: n });
          }
        }}
      />

      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">Photo (optional)</label>
        {c.imageUrl ? (
          <div className="flex items-start gap-3 mb-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={absImageUrl(c.imageUrl) ?? ""}
              alt=""
              className="w-24 h-24 object-cover rounded-lg border border-gray-200"
            />
            <button
              type="button"
              className="text-sm text-red-600 hover:underline font-medium disabled:opacity-50"
              disabled={busy || uploadingImage}
              onClick={() => {
                onMergeLocal(c.id, { imageUrl: null });
                void onSave(c.id, { imageUrl: null });
              }}
            >
              Remove photo
            </button>
          </div>
        ) : null}
        <input
          type="file"
          accept="image/*"
          className="text-sm max-w-full"
          disabled={busy || uploadingImage}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setUploadingImage(true);
            try {
              const url = await uploadPhoto(file);
              onMergeLocal(c.id, { imageUrl: url });
              await onSave(c.id, { imageUrl: url });
            } catch (err) {
              alert(err instanceof Error ? err.message : "Upload failed");
            } finally {
              setUploadingImage(false);
            }
          }}
        />
        {uploadingImage ? <p className="text-sm text-gray-500 mt-1">Uploading…</p> : null}
      </div>

      <button
        type="button"
        className="text-sm font-semibold px-3 py-2 rounded-lg border-2 disabled:opacity-50 bg-white"
        style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
        disabled={busy}
        onClick={() => setShowPreview(true)}
      >
        Preview coupon
      </button>

      {showPreview ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowPreview(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setShowPreview(false);
          }}
          role="presentation"
        >
          <div
            className="max-h-[90vh] overflow-y-auto w-full max-w-md rounded-2xl border-[3px] p-5 shadow-xl bg-[#f8e7c9]"
            style={{ borderColor: "var(--color-primary)" }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Coupon preview"
          >
            <div className="flex items-start justify-between gap-2 border-b-2 pb-3 mb-4" style={{ borderColor: "var(--color-primary)" }}>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">Preview</p>
                <p className="text-base font-semibold" style={{ color: "var(--color-primary)" }}>
                  How subscribers see this coupon
                </p>
              </div>
              <button
                type="button"
                className="text-sm font-medium px-2 py-1 rounded hover:bg-black/5"
                style={{ color: "var(--color-primary)" }}
                onClick={() => setShowPreview(false)}
              >
                ✕
              </button>
            </div>
            <p className="text-center font-medium mb-1" style={{ color: "var(--color-primary)" }}>
              {c.business?.name ?? "—"}
            </p>
            <p className="text-center text-lg font-bold mb-1" style={{ color: "var(--color-primary)" }}>
              {name.trim() || "Coupon title"}
            </p>
            <p className="text-center text-gray-800 mb-2">{discount.trim() || "Discount details"}</p>
            {previewExpireLine ? (
              <p className="text-center text-sm text-amber-900 font-medium mb-3">{previewExpireLine}</p>
            ) : null}
            <div
              className="min-h-[160px] rounded-lg border-[3px] bg-white flex items-center justify-center mb-4 overflow-hidden"
              style={{ borderColor: "var(--color-primary)" }}
            >
              {c.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={absImageUrl(c.imageUrl) ?? ""}
                  alt=""
                  className="w-full max-h-52 object-contain"
                />
              ) : (
                <span className="text-gray-400 p-4">No image</span>
              )}
            </div>
            <div className="rounded-lg border-2 p-4 bg-white mb-4" style={{ borderColor: "var(--color-primary)" }}>
              <p className="text-center text-sm font-semibold mb-1" style={{ color: "var(--color-primary)" }}>
                Code
              </p>
              <p className="text-center text-lg font-bold font-mono" style={{ color: "var(--color-primary)" }}>
                {code.trim() || "—"}
              </p>
            </div>
            <p className="text-center text-xs text-gray-600 mb-4 leading-relaxed">
              Subscribers with a plan see the code and can save the coupon. Address appears when listed on your business
              profile.
            </p>
            <button
              type="button"
              className="w-full py-3 rounded-lg font-semibold text-white"
              style={{ backgroundColor: "var(--color-primary)" }}
              onClick={() => setShowPreview(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        className="text-red-600 hover:underline font-medium text-sm disabled:opacity-50"
        disabled={busy}
        onClick={() => onDelete(c.id)}
      >
        {deletingId === c.id ? "Deleting…" : "Delete coupon"}
      </button>
    </div>
  );
}

export function OfferedCouponsClient({ initialCoupons }: { initialCoupons: CouponRow[] }) {
  const router = useRouter();
  const [coupons, setCoupons] = useState<CouponRow[]>(initialCoupons);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCoupons(initialCoupons);
  }, [initialCoupons]);

  function mergeLocal(id: string, patch: Partial<CouponRow>) {
    setCoupons((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  async function saveCoupon(id: string, patch: Record<string, unknown>) {
    setSavingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/coupons/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.formErrors?.[0] ?? data.error ?? "Failed to save");
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteCoupon(id: string) {
    if (!confirm("Delete this coupon? This cannot be undone.")) return;
    setDeletingId(id);
    setError(null);
    try {
      const res = await fetch(`/api/coupons/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to delete");
      setCoupons((prev) => prev.filter((c) => c.id !== id));
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-red-600">{error}</p>}
      {coupons.length === 0 ? (
        <p className="text-gray-500">No coupons found.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {coupons.map((c) => (
            <CouponEditCard
              key={c.id}
              c={c}
              onMergeLocal={mergeLocal}
              onSave={saveCoupon}
              onDelete={deleteCoupon}
              savingId={savingId}
              deletingId={deletingId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
