"use client";

import type { ChannelConnectionSummary } from "@/lib/channels/provider-ui";
import { listingsLabel, overlapCounts } from "@/lib/channels/disconnect-inw-items";

export type DisconnectChannelPrompt = {
  conn: ChannelConnectionSummary;
  name: string;
  step: "choose" | "confirmExclusive" | "confirmAll";
};

export function disconnectBaseMessage(name: string, linkedListings: number): string {
  return linkedListings > 0
    ? `You have ${listingsLabel(linkedListings)} tied to ${name}. Sync will stop in both directions. Your listings on ${name} are not removed by INW.\n\nNWC is not responsible for inventory, oversells, or other business effects after you disconnect (see Terms of Service).`
    : `Your ${name} account will disconnect from INW Community. Any items you add later on INW will not sync to ${name} until you connect again.`;
}

type Props = {
  prompt: DisconnectChannelPrompt | null;
  busy: boolean;
  onClose: () => void;
  onKeepOnInw: () => void;
  onRequestExclusive: () => void;
  onRequestDeleteAll: () => void;
  onConfirmExclusive: () => void;
  onConfirmDeleteAll: () => void;
  onDisconnectNoLinks: () => void;
};

function OutcomeButton({
  title,
  detail,
  onClick,
  disabled,
  variant,
  busyLabel,
  busy,
}: {
  title: string;
  detail: string;
  onClick: () => void;
  disabled: boolean;
  variant: "keep" | "mixed" | "danger" | "cancel";
  busyLabel?: string;
  busy?: boolean;
}) {
  const styles = {
    keep: "border-[var(--color-primary)] bg-white text-[var(--color-primary)] hover:bg-gray-50",
    mixed: "border-[var(--color-primary)] bg-[var(--color-primary)] text-white hover:opacity-90",
    danger: "border-red-700 bg-red-700 text-white hover:bg-red-800",
    cancel: "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
  } as const;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full rounded-lg border-2 px-4 py-2.5 text-left disabled:opacity-50 ${styles[variant]}`}
    >
      <span className="block text-sm font-semibold">{busy && busyLabel ? busyLabel : title}</span>
      <span className={`block text-xs mt-0.5 font-normal ${variant === "mixed" || variant === "danger" ? "text-white/90" : "text-gray-600"}`}>
        {detail}
      </span>
    </button>
  );
}

export function DisconnectChannelModal({
  prompt,
  busy,
  onClose,
  onKeepOnInw,
  onRequestExclusive,
  onRequestDeleteAll,
  onConfirmExclusive,
  onConfirmDeleteAll,
  onDisconnectNoLinks,
}: Props) {
  if (!prompt) return null;

  const { conn, name, step } = prompt;
  const { linked, onlyThis, alsoOthers } = overlapCounts(conn);
  const hasLinks = linked > 0;
  const showExclusive = onlyThis > 0 && alsoOthers > 0;

  if (step === "confirmExclusive") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-exclusive-title"
      >
        <div className="w-full max-w-lg rounded-xl border-2 border-[var(--color-primary)] bg-white p-5 shadow-xl">
          <h2 id="disconnect-exclusive-title" className="text-lg font-bold mb-3">
            Keep listings on other stores?
          </h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap mb-6">
            {`This deletes ${listingsLabel(onlyThis)} from INW that ${onlyThis === 1 ? "is" : "are"} only linked to ${name}. ${listingsLabel(alsoOthers)} also on other connected stores will stay on INW.\n\nListings on ${name} and your other stores are not removed. After disconnecting, you are responsible for inventory on every channel (see Terms of Service).`}
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmExclusive}
              disabled={busy}
              className="rounded-lg border-2 border-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {busy ? "Disconnecting…" : "Keep other-store listings"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "confirmAll") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-delete-title"
      >
        <div className="w-full max-w-lg rounded-xl border-2 border-[var(--color-primary)] bg-white p-5 shadow-xl">
          <h2 id="disconnect-delete-title" className="text-lg font-bold mb-3">
            Delete all from INW Community?
          </h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap mb-6">
            {alsoOthers > 0
              ? `This permanently removes ${listingsLabel(linked)} from your INW storefront. ${listingsLabel(alsoOthers)} ${alsoOthers === 1 ? "is" : "are"} also linked to other connected stores — those INW listings will be deleted and INW will stop tracking them there.\n\nListings on ${name} and other marketplaces stay live. After disconnecting, you are responsible for inventory on every channel (see Terms of Service).`
              : `This permanently removes ${listingsLabel(linked)} from your INW storefront only. None of them are linked to another connected store. Listings on ${name} stay as they are.\n\nAfter disconnecting, you are responsible for inventory and sales on ${name} and any other channel (see Terms of Service).`}
          </p>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmDeleteAll}
              disabled={busy}
              className="rounded-lg border-2 border-red-700 bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {busy ? "Disconnecting…" : "Delete all from INW"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disconnect-title"
    >
      <div className="w-full max-w-lg rounded-xl border-2 border-[var(--color-primary)] bg-white p-5 shadow-xl">
        <h2 id="disconnect-title" className="text-lg font-bold mb-3">
          Disconnect {name}?
        </h2>
        <p className="text-sm text-gray-600 whitespace-pre-wrap mb-4">
          {disconnectBaseMessage(name, linked)}
        </p>
        {hasLinks ? (
          <>
            <ul className="mb-4 text-sm text-gray-700 list-disc pl-5 space-y-1">
              <li>
                {listingsLabel(linked)} linked to {name}
              </li>
              {alsoOthers > 0 ? (
                <li>
                  {listingsLabel(alsoOthers)} also linked to another connected store
                </li>
              ) : (
                <li>None of these listings are linked to another connected store</li>
              )}
              {onlyThis > 0 && alsoOthers > 0 ? (
                <li>
                  {listingsLabel(onlyThis)} only on {name}
                </li>
              ) : null}
            </ul>
            <p className="text-sm font-semibold text-gray-800 mb-2">Choose what happens on INW:</p>
            <div className="flex flex-col gap-2">
              <OutcomeButton
                title="Keep all on INW"
                detail={`Disconnect only. All ${listingsLabel(linked)} stay on your INW storefront and stay linked to any other stores.`}
                onClick={onKeepOnInw}
                disabled={busy}
                variant="keep"
                busy={busy}
                busyLabel="Disconnecting…"
              />
              {showExclusive ? (
                <OutcomeButton
                  title="Keep listings on other stores"
                  detail={`Delete ${listingsLabel(onlyThis)} that ${onlyThis === 1 ? "is" : "are"} only on ${name}. Keep ${listingsLabel(alsoOthers)} that ${alsoOthers === 1 ? "is" : "are"} also on other connected stores.`}
                  onClick={onRequestExclusive}
                  disabled={busy}
                  variant="mixed"
                />
              ) : null}
              <OutcomeButton
                title="Delete all from INW"
                detail={
                  alsoOthers > 0
                    ? `Remove all ${listingsLabel(linked)} from INW, including ${listingsLabel(alsoOthers)} that ${alsoOthers === 1 ? "is" : "are"} also on other stores. Marketplace listings stay live, but INW will stop tracking those items.`
                    : `Remove all ${listingsLabel(linked)} from your INW storefront. Listings on ${name} stay as they are.`
                }
                onClick={onRequestDeleteAll}
                disabled={busy}
                variant="danger"
              />
              <OutcomeButton
                title="Cancel"
                detail="Leave this store connected."
                onClick={onClose}
                disabled={busy}
                variant="cancel"
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onDisconnectNoLinks}
              disabled={busy}
              className="rounded-lg border-2 border-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {busy ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
