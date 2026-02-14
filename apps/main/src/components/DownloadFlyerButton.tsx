"use client";

import { useState } from "react";

interface DownloadFlyerButtonProps {
  businessId: string;
  slug: string;
  className?: string;
  children?: React.ReactNode;
}

export function DownloadFlyerButton({ businessId, slug, className, children }: DownloadFlyerButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/flyer`, { credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data?.error ?? `Download failed (${res.status})`;
        alert(message);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nwc-flyer-${slug}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert("Download failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={loading}
      className={className}
      aria-busy={loading}
    >
      {loading ? "Preparing…" : (children ?? "Download Printable Flyer")}
    </button>
  );
}
