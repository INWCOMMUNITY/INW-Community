"use client";

import { useState, useEffect } from "react";
import { invalidateSiteImageUrls } from "@/components/SiteImageUrls";

interface SiteImageItem {
  key: string;
  label: string;
  path: string;
  url: string;
  isOverridden: boolean;
}

export default function AdminSiteImagesPage() {
  const [items, setItems] = useState<SiteImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/site-images");
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setItems(data.items ?? []);
    } catch {
      setError("Could not load site images.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleReplace(key: string, file: File) {
    setUploading(key);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("key", key);
const res = await fetch("/api/admin/site-images/upload", {
      method: "POST",
      body: form,
    });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      invalidateSiteImageUrls();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(null);
    }
  }

  async function handleReset(key: string) {
    setResetting(key);
    setError("");
    try {
const res = await fetch(`/api/admin/site-images?key=${encodeURIComponent(key)}`, {
      method: "DELETE",
    });
      if (!res.ok) throw new Error("Failed to reset");
      invalidateSiteImageUrls();
      await load();
    } catch {
      setError("Could not reset image.");
    } finally {
      setResetting(null);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Site Images</h1>
      <p className="text-gray-600 mb-6">
        Upload or replace images used across the site. Images are stored at <strong>original quality with no compression</strong>—use high-resolution source files (PNG for graphics, JPEG for photos) for best results. Requires Vercel Blob storage in production.
      </p>

      {error && (
        <div className="mb-6 p-4 rounded bg-red-50 text-red-700 border border-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {items.map((item) => (
          <div
            key={item.key}
            className="border rounded-lg overflow-hidden bg-white"
            style={{ borderColor: "#e5e3df" }}
          >
            <div className="aspect-video bg-gray-100 flex items-center justify-center overflow-hidden">
              <img
                src={item.url}
                alt={item.label}
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                  const parent = (e.target as HTMLImageElement).parentElement;
                  if (parent) {
                    const fallback = document.createElement("span");
                    fallback.className = "text-gray-400 text-sm";
                    fallback.textContent = "No image";
                    parent.appendChild(fallback);
                  }
                }}
              />
            </div>
            <div className="p-3">
              <p className="font-medium text-sm mb-1" style={{ color: "#3E432F" }}>
                {item.label}
              </p>
              <p className="text-xs text-gray-500 mb-3 truncate">{item.path}</p>
              <div className="flex gap-2">
                <label className="flex-1">
                  <span
                    className="block w-full text-center text-sm py-1.5 rounded cursor-pointer hover:opacity-90"
                    style={{
                      backgroundColor: uploading === item.key ? "#e5e3df" : "#505542",
                      color: "#fff",
                    }}
                  >
                    {uploading === item.key ? "Uploading…" : "Replace"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={uploading !== null}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleReplace(item.key, f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {item.isOverridden && (
                  <button
                    type="button"
                    onClick={() => handleReset(item.key)}
                    disabled={resetting !== null}
                    className="text-sm py-1.5 px-3 rounded border hover:bg-gray-50"
                    style={{ borderColor: "#e5e3df", color: "#505542" }}
                  >
                    {resetting === item.key ? "…" : "Reset"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
