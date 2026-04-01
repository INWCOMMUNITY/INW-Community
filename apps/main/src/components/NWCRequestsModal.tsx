"use client";

import { useLockBodyScroll } from "@/lib/scroll-lock";
import { NwcRequestFormBody } from "@/components/NwcRequestFormBody";

interface NWCRequestsModalProps {
  open: boolean;
  onClose: () => void;
}

export function NWCRequestsModal({ open, onClose }: NWCRequestsModalProps) {
  useLockBodyScroll(open);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/70 isolate overflow-hidden"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-lg bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-xl font-bold">NWC Requests</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-100 text-gray-600"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path
                fillRule="evenodd"
                d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
        <div className="p-4">
          <NwcRequestFormBody onCancel={onClose} afterThankYou={onClose} />
        </div>
      </div>
    </div>
  );
}
