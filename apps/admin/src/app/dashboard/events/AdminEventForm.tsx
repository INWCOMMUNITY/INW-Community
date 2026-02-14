"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CALENDAR_TYPES } from "types";

const MAIN_URL = process.env.NEXT_PUBLIC_MAIN_SITE_URL || "http://localhost:3000";
const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE ?? "NWC36481";

interface AdminEventFormProps {
  onClose: () => void;
}

export function AdminEventForm({ onClose }: AdminEventFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [calendarType, setCalendarType] = useState<string>(CALENDAR_TYPES[0].value);
  const [photos, setPhotos] = useState<string[]>([]);
  const [status, setStatus] = useState<"pending" | "approved">("approved");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

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
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${MAIN_URL}/api/admin/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-code": ADMIN_CODE,
        },
        body: JSON.stringify({
          title,
          date,
          time: time || null,
          endTime: endTime || null,
          location: location || null,
          description: description || null,
          calendarType,
          photos,
          status,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error?.message ?? data.error ?? "Failed to create event.");
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
      <div>
        <label className="block text-sm font-medium mb-1">Event title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Calendar *</label>
        <select
          value={calendarType}
          onChange={(e) => setCalendarType(e.target.value)}
          required
          className="w-full border rounded px-3 py-2"
        >
          {CALENDAR_TYPES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">Date *</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full border rounded px-3 py-2"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Start time</label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-full border rounded px-3 py-2"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">End time (optional)</label>
        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="w-full border rounded px-3 py-2 max-w-[200px]"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Location</label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full border rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "pending" | "approved")}
          className="w-full border rounded px-3 py-2 max-w-[200px]"
        >
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Photos (optional)</label>
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
        {photos.length > 0 && (
          <ul className="space-y-2 mt-3">
            {photos.map((url, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <img src={url} alt="" className="w-12 h-12 object-cover rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <span className="truncate flex-1 text-gray-500">Photo {i + 1}</span>
                <button
                  type="button"
                  onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                  className="text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded px-4 py-2 disabled:opacity-50"
          style={{ backgroundColor: "#505542", color: "#fff" }}
        >
          {submitting ? "Creating…" : "Create event"}
        </button>
        <button type="button" onClick={onClose} className="px-4 py-2 border rounded hover:bg-gray-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
