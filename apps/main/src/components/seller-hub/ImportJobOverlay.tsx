"use client";

import Image from "next/image";

export const IMPORT_BAR_TRACK = "#FDEDCC";
export const IMPORT_BAR_FILL = "#3E432F";

export type ImportResultImported = {
  externalListingId?: string;
  storeItemId?: string;
  title?: string;
  photo?: string;
};

export type ImportResultSkipped = {
  externalListingId: string;
  title?: string;
  photo?: string;
  step?: string;
  reason: string;
  hint?: string;
  retryable?: boolean;
};

export function ImportPercentBar({
  percent,
  processed,
  total,
  currentTitle,
  actionWord = "Importing",
}: {
  percent: number;
  processed: number;
  total: number;
  currentTitle?: string | null;
  actionWord?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="w-full space-y-3">
      <div
        className="h-3 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: IMPORT_BAR_TRACK }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{ width: `${clamped}%`, backgroundColor: IMPORT_BAR_FILL }}
        />
      </div>
      <p className="text-sm font-semibold text-gray-900">
        {clamped}%
        {total > 0 ? (
          <span className="ml-2 font-normal text-gray-600">
            {processed} of {total}
          </span>
        ) : null}
      </p>
      {currentTitle ? (
        <p className="text-sm text-gray-600 line-clamp-2">
          {actionWord} {currentTitle}…
        </p>
      ) : (
        <p className="text-sm text-gray-600">Preparing import…</p>
      )}
    </div>
  );
}

export function ImportResultTabs({
  imported,
  skipped,
  tab,
  onTab,
  onShare,
  onDone,
  onRetry,
  retrying,
}: {
  imported: ImportResultImported[];
  skipped: ImportResultSkipped[];
  tab: "on-inw" | "attention";
  onTab: (tab: "on-inw" | "attention") => void;
  onShare: () => void;
  onDone: () => void;
  onRetry: (ids: string[]) => void;
  retrying?: boolean;
}) {
  const retryable = skipped.filter((s) => s.retryable);
  return (
    <div className="flex max-h-[80vh] w-full max-w-lg flex-col">
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          className={`flex-1 px-3 py-3 text-sm font-semibold ${
            tab === "on-inw" ? "border-b-2 border-[#3E432F] text-[#3E432F]" : "text-gray-500"
          }`}
          onClick={() => onTab("on-inw")}
        >
          On INW{imported.length ? ` (${imported.length})` : ""}
        </button>
        <button
          type="button"
          className={`flex-1 px-3 py-3 text-sm font-semibold ${
            tab === "attention" ? "border-b-2 border-[#3E432F] text-[#3E432F]" : "text-gray-500"
          }`}
          onClick={() => onTab("attention")}
        >
          Needs attention{skipped.length ? ` (${skipped.length})` : ""}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "on-inw" ? (
          imported.length === 0 ? (
            <p className="text-sm text-gray-600">No listings were added to INW.</p>
          ) : (
            <ul className="space-y-3">
              {imported.map((row, i) => (
                <li key={row.storeItemId ?? `${row.externalListingId}-${i}`} className="flex items-center gap-3">
                  {row.photo ? (
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gray-100">
                      <Image src={row.photo} alt="" fill className="object-cover" sizes="48px" unoptimized />
                    </div>
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded-md bg-gray-100" />
                  )}
                  <p className="text-sm font-medium leading-snug line-clamp-2">{row.title ?? "Listing"}</p>
                </li>
              ))}
            </ul>
          )
        ) : skipped.length === 0 ? (
          <p className="text-sm text-gray-600">Everything imported cleanly.</p>
        ) : (
          <ul className="space-y-4">
            {skipped.map((row) => (
              <li key={row.externalListingId} className="space-y-1">
                <div className="flex items-start gap-3">
                  {row.photo ? (
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gray-100">
                      <Image src={row.photo} alt="" fill className="object-cover" sizes="48px" unoptimized />
                    </div>
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded-md bg-gray-100" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-snug">{row.title ?? row.externalListingId}</p>
                    <p className="mt-1 text-sm text-gray-700">{row.reason}</p>
                    {row.hint ? <p className="mt-1 text-xs text-gray-500">{row.hint}</p> : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-gray-200 p-4">
        {tab === "on-inw" ? (
          <>
            {imported.length > 0 ? (
              <button
                type="button"
                onClick={onShare}
                className="w-full rounded-lg py-3 font-semibold text-white"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                Share to feed
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDone}
              className={`w-full rounded-lg py-3 font-semibold ${
                imported.length > 0
                  ? "border border-gray-300 bg-white text-gray-800"
                  : "text-white"
              }`}
              style={imported.length > 0 ? undefined : { backgroundColor: "var(--color-primary)" }}
            >
              Done
            </button>
          </>
        ) : (
          <>
            {retryable.length > 0 ? (
              <button
                type="button"
                onClick={() => onRetry(retryable.map((s) => s.externalListingId))}
                disabled={retrying}
                className="w-full rounded-lg py-3 font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: "var(--color-primary)" }}
              >
                {retrying
                  ? "Retrying…"
                  : `Retry ${retryable.length} listing${retryable.length === 1 ? "" : "s"}`}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onDone}
              className="w-full rounded-lg border border-gray-300 bg-white py-3 font-semibold text-gray-800"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
