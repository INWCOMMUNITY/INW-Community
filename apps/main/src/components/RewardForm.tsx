"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { getErrorMessage } from "@/lib/api-error";

interface Business {
  id: string;
  name: string;
  slug: string;
}

interface RewardFormProps {
  /** When provided, called after successful submit instead of redirecting (e.g. close modal). */
  onSuccess?: () => void;
}

export function RewardForm({ onSuccess }: RewardFormProps = {}) {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [pointsRequired, setPointsRequired] = useState("");
  const [redemptionLimit, setRedemptionLimit] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/businesses?mine=1")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setBusinesses(data);
          setBusinessId((prev) => prev || (data[0]?.id ?? ""));
        }
      })
      .catch(() => setBusinesses([]));
  }, []);

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

  async function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImage(true);
    setError("");
    try {
      const url = await uploadFile(file);
      setImageUrl(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingImage(false);
      e.target.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const points = parseInt(pointsRequired, 10);
    const limit = parseInt(redemptionLimit, 10);
    if (!businessId) {
      setError("Select a business");
      return;
    }
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (isNaN(points) || points < 1) {
      setError("Points required must be at least 1");
      return;
    }
    if (isNaN(limit) || limit < 1) {
      setError("Redemption limit must be at least 1");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/rewards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          title: title.trim(),
          description: description.trim() || null,
          pointsRequired: points,
          redemptionLimit: limit,
          imageUrl: imageUrl || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to create reward"));
        return;
      }
      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/sponsor-hub");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (businesses.length === 0) {
    return (
      <div className="border rounded-lg p-6 bg-amber-50">
        <p className="font-medium mb-2">You need at least one business to offer a reward.</p>
        <a href="/sponsor-hub/business" className="btn inline-block">
          Set up your business first
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      <div>
        <label className="block text-sm font-medium mb-1">Business *</label>
        <select
          value={businessId}
          onChange={(e) => setBusinessId(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        >
          {businesses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Reward title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g. $25 gift card"
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Describe the reward..."
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Points required to redeem *</label>
          <input
            type="number"
            min={1}
            value={pointsRequired}
            onChange={(e) => setPointsRequired(e.target.value)}
            required
            placeholder="e.g. 500"
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">How many times can it be redeemed? *</label>
          <input
            type="number"
            min={1}
            value={redemptionLimit}
            onChange={(e) => setRedemptionLimit(e.target.value)}
            required
            placeholder="e.g. 10"
            className="w-full border rounded px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">Reward is removed from the page when this limit is reached.</p>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Photo (optional)</label>
        {imageUrl ? (
          <div className="relative inline-block mb-2">
            <img src={imageUrl} alt="" className="w-24 h-24 object-cover rounded" />
            <button
              type="button"
              onClick={() => setImageUrl("")}
              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
            >
              ×
            </button>
          </div>
        ) : null}
        <label className="cursor-pointer inline-block">
          <span className="inline-block px-4 py-2 border rounded hover:bg-gray-100">
            {uploadingImage ? "Uploading…" : imageUrl ? "Change photo" : "Upload photo"}
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            disabled={uploadingImage}
            className="sr-only"
          />
        </label>
        <p className="text-xs text-gray-500 mt-1">Max 40MB. JPEG, PNG, WebP, GIF.</p>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? "Creating…" : "Create reward"}
      </button>
    </form>
  );
}
