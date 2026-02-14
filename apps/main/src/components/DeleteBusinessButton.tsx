"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface DeleteBusinessButtonProps {
  businessId: string;
  businessName: string;
  className?: string;
}

export function DeleteBusinessButton({ businessId, businessName, className }: DeleteBusinessButtonProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to delete");
      }
      router.push("/sponsor-hub/business");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete business");
      setDeleting(false);
    }
  }

  if (confirming) {
    return (
      <div className={`mt-8 p-4 border border-red-200 rounded-lg bg-red-50 ${className ?? ""}`}>
        <p className="text-sm text-gray-800 mb-3">
          Delete <strong>{businessName}</strong>? This cannot be undone.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="btn bg-red-600 text-white border-red-600 hover:bg-red-700 hover:border-red-700"
          >
            {deleting ? "Deleting…" : "Yes, delete business"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={deleting}
            className="btn border border-gray-300 bg-white hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`mt-8 pt-6 border-t border-gray-200 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm text-red-600 hover:text-red-700 hover:underline"
      >
        Delete business
      </button>
    </div>
  );
}
