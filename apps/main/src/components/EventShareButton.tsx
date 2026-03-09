"use client";

import { useState } from "react";

interface EventShareButtonProps {
  /** Full URL or path (e.g. /events/my-event). If path, full URL is built in client. */
  eventUrl: string;
  eventTitle: string;
  className?: string;
}

export function EventShareButton({ eventUrl, eventTitle, className = "" }: EventShareButtonProps) {
  const [copied, setCopied] = useState(false);
  const fullUrl = typeof window !== "undefined" && eventUrl.startsWith("/")
    ? `${window.location.origin}${eventUrl}`
    : eventUrl;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = fullUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleNativeShare() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: eventTitle,
          url: fullUrl,
          text: eventTitle,
        });
      } catch {
        // User cancelled or not available
      }
    } else {
      handleCopy();
    }
  }

  return (
    <div className={`inline-flex gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleNativeShare}
        className="btn text-sm"
      >
        Share event with a friend
      </button>
      <button
        type="button"
        onClick={handleCopy}
        className="btn text-sm border"
      >
        {copied ? "Copied!" : "Copy link"}
      </button>
    </div>
  );
}
