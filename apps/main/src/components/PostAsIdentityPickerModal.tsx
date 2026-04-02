"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLockBodyScroll } from "@/lib/scroll-lock";

export interface PostAsIdentityBusinessOption {
  id: string;
  name: string;
}

interface PostAsIdentityPickerModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  profileDisplayName: string;
  businesses: PostAsIdentityBusinessOption[];
  onSelectPersonal: () => void;
  onSelectBusiness: (business: PostAsIdentityBusinessOption) => void;
}

const backdropClass =
  "fixed left-0 right-0 bottom-0 z-[120] flex items-end sm:items-center justify-center p-4 bg-black/50";

export function PostAsIdentityPickerModal({
  open,
  onClose,
  title = "Create post",
  subtitle = "Choose who is posting so it appears under the right name in the feed.",
  profileDisplayName,
  businesses,
  onSelectPersonal,
  onSelectBusiness,
}: PostAsIdentityPickerModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLockBodyScroll(open);

  if (!open || !mounted) return null;

  const modal = (
    <div
      className={backdropClass}
      style={{ top: "var(--site-header-height, 5rem)" }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="post-as-picker-title"
      onClick={onClose}
    >
      <div
        className="relative z-[1] isolate bg-white rounded-t-xl sm:rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border-2 border-[var(--color-primary)]"
        style={{
          maxHeight:
            "min(88vh, calc(100dvh - var(--site-header-height, 5rem) - 2rem))",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-white shrink-0">
          <h2 id="post-as-picker-title" className="text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-500 hover:text-gray-800 text-2xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-4 space-y-2 bg-white">
          <p className="text-sm text-gray-600 mb-3">{subtitle}</p>
          <button
            type="button"
            onClick={onSelectPersonal}
            className="w-full flex items-center gap-3 text-left px-3 py-3 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <span className="text-xl" aria-hidden>
              👤
            </span>
            <span className="font-medium flex-1">Post as &quot;{profileDisplayName}&quot;</span>
            <span className="text-gray-400">›</span>
          </button>
          {businesses.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onSelectBusiness(b)}
              className="w-full flex items-center gap-3 text-left px-3 py-3 rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              <span className="text-xl" aria-hidden>
                🏪
              </span>
              <span className="font-medium flex-1">Post as &quot;{b.name}&quot;</span>
              <span className="text-gray-400">›</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
