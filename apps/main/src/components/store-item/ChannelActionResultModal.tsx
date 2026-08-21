"use client";

import { useLockBodyScroll } from "@/lib/scroll-lock";

export type ChannelActionResult = {
  title: string;
  message: string;
  ok: boolean;
};

export function ChannelActionResultModal({
  result,
  onClose,
}: {
  result: ChannelActionResult;
  onClose: () => void;
}) {
  useLockBodyScroll(true);

  return (
    <div
      className="fixed inset-0 z-[270] flex items-center justify-center p-4 bg-black/40"
      role="alertdialog"
      aria-labelledby="channel-action-result-title"
      aria-describedby="channel-action-result-body"
    >
      <button type="button" className="absolute inset-0" aria-label="Close" onClick={onClose} />
      <div
        className="relative z-10 w-full max-w-md rounded-xl border-2 bg-white p-5 shadow-xl"
        style={{ borderColor: result.ok ? "var(--color-primary)" : "#b91c1c" }}
      >
        <h3
          id="channel-action-result-title"
          className="text-base font-bold mb-2"
          style={{ color: result.ok ? "var(--color-heading)" : "#991b1b" }}
        >
          {result.title}
        </h3>
        <p
          id="channel-action-result-body"
          className="text-sm text-gray-700 whitespace-pre-wrap break-words"
        >
          {result.message}
        </p>
        <button type="button" className="btn mt-4 w-full text-sm" onClick={onClose}>
          OK
        </button>
      </div>
    </div>
  );
}
