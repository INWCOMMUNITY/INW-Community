"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface SaveAndShareProps {
  type: "event" | "business" | "coupon" | "store_item";
  referenceId: string;
  shareUrl: string;
}

export function SaveAndShare({ type, referenceId, shareUrl }: SaveAndShareProps) {
  const { data: session, status } = useSession();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSave() {
    if (status !== "authenticated") return;
    const res = await fetch("/api/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, referenceId }),
    });
    if (res.ok) setSaved(true);
  }

  function handleCopy() {
    const url = (typeof window !== "undefined" ? window.location.href : shareUrl) || "";
    if (url) navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex gap-4 mt-4">
      {status === "authenticated" ? (
        <button onClick={handleSave} className="btn" disabled={saved}>
          {saved ? "Saved to My Community" : "Save to My Community"}
        </button>
      ) : (
        <Link href="/login" className="btn">Log in to save</Link>
      )}
      <button onClick={handleCopy} className="btn">
        {copied ? "Link copied!" : "Copy link"}
      </button>
    </div>
  );
}
