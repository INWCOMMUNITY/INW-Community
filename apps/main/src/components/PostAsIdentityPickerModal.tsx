"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IonIcon } from "@/components/IonIcon";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import {
  SITE_NAV_BAND,
  SITE_PAGE_SHELL,
  SiteHeaderActionsSpacer,
  SiteHeaderLogoSpacer,
} from "@/components/SiteNavAlignedColumn";

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
  "fixed left-0 right-0 bottom-0 z-[120] bg-black/50 overflow-y-auto";
const panelClass =
  "relative z-[1] isolate bg-white rounded-t-xl md:rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border-2 border-[var(--color-primary)] pointer-events-auto";

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

  const panelMaxHeight =
    "min(88vh, calc(100dvh - var(--site-header-height, 5rem) - 2rem))";

  const panel = (
    <div
      className={panelClass}
      style={{ maxHeight: panelMaxHeight }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b bg-white shrink-0">
        <h2 id="post-as-picker-title" className="text-lg font-bold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-800 p-1 rounded"
          aria-label="Close"
        >
          <IonIcon name="close-outline" size={24} />
        </button>
      </div>
      <div className="overflow-y-auto p-4 space-y-2 bg-white">
        <p className="text-sm text-gray-600 mb-3">{subtitle}</p>
        <button
          type="button"
          onClick={onSelectPersonal}
          className="w-full flex items-center gap-3 text-left px-3 py-3 rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          <IonIcon
            name="person-outline"
            size={22}
            className="shrink-0 text-[var(--color-primary)]"
          />
          <span className="font-medium flex-1">Post as &quot;{profileDisplayName}&quot;</span>
          <IonIcon name="chevron-forward" size={20} className="shrink-0 text-gray-400" />
        </button>
        {businesses.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelectBusiness(b)}
            className="w-full flex items-center gap-3 text-left px-3 py-3 rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <IonIcon
              name="business-outline"
              size={22}
              className="shrink-0 text-[var(--color-primary)]"
            />
            <span className="font-medium flex-1">Post as &quot;{b.name}&quot;</span>
            <IonIcon name="chevron-forward" size={20} className="shrink-0 text-gray-400" />
          </button>
        ))}
      </div>
    </div>
  );

  const modal = (
    <div
      className={backdropClass}
      style={{ top: "var(--site-header-height, 5rem)" }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="post-as-picker-title"
      onClick={onClose}
    >
      <div className={`hidden md:block ${SITE_PAGE_SHELL} min-h-full`}>
        <div className="grid grid-cols-[auto_1fr_auto] min-h-full items-center">
          <SiteHeaderLogoSpacer />
          <div
            className={`${SITE_NAV_BAND} min-w-0 flex justify-center items-center py-4 px-4`}
          >
            {panel}
          </div>
          <SiteHeaderActionsSpacer />
        </div>
      </div>
      <div className="md:hidden flex min-h-full items-end sm:items-center justify-center p-4">
        {panel}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
