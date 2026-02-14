"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { getErrorMessage } from "@/lib/api-error";
import { CALENDAR_TYPES, type CalendarType } from "types";

const VALID_CALENDAR_VALUES = new Set<string>(CALENDAR_TYPES.map((c) => c.value));

interface EventFormProps {
  successRedirect?: string;
  initialCalendarType?: string | null;
  /** When true, calendar dropdown is hidden and initialCalendarType is used (e.g. in modal from a specific calendar). */
  hideCalendarSelect?: boolean;
  /** When provided, called after successful post instead of redirecting (e.g. close modal and refresh). */
  onSuccess?: () => void;
}

export function EventForm({
  successRedirect = "/sponsor-hub",
  initialCalendarType,
  hideCalendarSelect = false,
  onSuccess,
}: EventFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [calendarType, setCalendarType] = useState<CalendarType>(() =>
    initialCalendarType && VALID_CALENDAR_VALUES.has(initialCalendarType)
      ? (initialCalendarType as CalendarType)
      : CALENDAR_TYPES[0].value
  );
  const effectiveCalendarType: CalendarType =
    hideCalendarSelect && initialCalendarType && VALID_CALENDAR_VALUES.has(initialCalendarType)
      ? (initialCalendarType as CalendarType)
      : calendarType;
  const [photos, setPhotos] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [showThankYou, setShowThankYou] = useState(false);

  async function uploadFile(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload/event", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Upload failed");
    const url = data.url;
    if (!url) throw new Error("No URL returned");
    if (url.startsWith("/")) return `${window.location.origin}${url}`;
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

  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          date,
          time: time || null,
          endTime: endTime || null,
          location: location || null,
          description: description || null,
          calendarType: effectiveCalendarType,
          photos,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getErrorMessage(data.error, "Failed to post event."));
        return;
      }
      setShowThankYou(true);
    } finally {
      setSubmitting(false);
    }
  }

  function dismissThankYou() {
    setShowThankYou(false);
    if (onSuccess) {
      onSuccess();
    } else {
      router.push(successRedirect);
    }
    router.refresh();
  }

  useLockBodyScroll(showThankYou);

  return (
    <>
      {showThankYou && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 overflow-hidden"
          aria-modal="true"
          role="dialog"
          aria-labelledby="event-thank-you-title"
        >
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 text-center">
            <h2 id="event-thank-you-title" className="text-xl font-bold mb-3">
              Thank you for submitting an event!
            </h2>
            <p className="text-gray-700 mb-6">
              Northwest Community will review the event soon!
            </p>
            <button
              type="button"
              onClick={dismissThankYou}
              className="btn"
            >
              OK
            </button>
          </div>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl max-md:mx-auto">
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
      {!hideCalendarSelect && (
        <div>
          <label className="block text-sm font-medium mb-1">Calendar *</label>
          <select
            value={calendarType}
            onChange={(e) => setCalendarType(e.target.value as CalendarType)}
            required
            className="w-full border rounded px-3 py-2"
          >
            {CALENDAR_TYPES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
      )}
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
        <p className="text-xs text-gray-500 mt-1">Upload from your device or camera. Max 40MB each. JPEG, PNG, WebP, GIF.</p>
        {photos.length > 0 && (
          <ul className="space-y-2 mt-3">
            {photos.map((url, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <img src={url} alt="" className="w-12 h-12 object-cover rounded" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <span className="truncate flex-1 text-gray-500">Photo {i + 1}</span>
                <button type="button" onClick={() => removePhoto(i)} className="text-red-600 hover:underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <div className="max-md:flex max-md:justify-center max-md:w-full">
        <button type="submit" className="btn" disabled={submitting}>
          {submitting ? "Posting…" : "Post event"}
        </button>
      </div>
    </form>
    </>
  );
}
