"use client";

import { useEffect, useState } from "react";
import { useLockBodyScroll } from "@/lib/scroll-lock";

const REASONS = [
  { value: "political", label: "Political content" },
  { value: "nudity", label: "Nudity / explicit" },
  { value: "spam", label: "Spam" },
  { value: "hate", label: "Hate speech" },
  { value: "other", label: "Other" },
] as const;

type Reason = (typeof REASONS)[number]["value"];

type ReportPostDialogProps = {
  open: boolean;
  postId: string | null;
  authorId?: string | null;
  onClose: () => void;
  onSubmitted?: () => void;
  onBlockUser?: () => void;
};

export function ReportPostDialog({
  open,
  postId,
  authorId,
  onClose,
  onSubmitted,
  onBlockUser,
}: ReportPostDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"reason" | "block">("reason");
  useLockBodyScroll(open);

  useEffect(() => {
    if (!open) {
      setStep("reason");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !postId) return null;

  async function submit(reason: Reason) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType: "post", contentId: postId, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Could not submit report");
      onSubmitted?.();
      if (authorId && onBlockUser) {
        setStep("block");
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-post-title"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "reason" ? (
          <>
            <h2 id="report-post-title" className="text-lg font-bold mb-3">
              Report post
            </h2>
            <p className="text-sm text-gray-600 mb-4">Why are you reporting this post?</p>
            <div className="flex flex-col gap-2">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => void submit(r.value)}
                  className="text-left rounded-lg border border-gray-200 px-4 py-2.5 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {r.label}
                </button>
              ))}
            </div>
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            <button type="button" onClick={onClose} className="mt-4 text-sm text-gray-600 hover:underline">
              Cancel
            </button>
          </>
        ) : (
          <>
            <h2 id="report-post-title" className="text-lg font-bold mb-3">
              Block this user?
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              You reported this post. You can also block the author so their content is hidden from your feed.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2.5 text-sm font-semibold text-white bg-[var(--color-primary)]"
                onClick={() => {
                  onBlockUser?.();
                  onClose();
                }}
              >
                Block user
              </button>
              <button type="button" onClick={onClose} className="text-sm text-gray-600 hover:underline py-2">
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
