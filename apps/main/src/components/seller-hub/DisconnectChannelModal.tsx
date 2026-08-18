"use client";

import type { ChannelConnectionSummary } from "@/lib/channels/provider-ui";

export type DisconnectChannelPrompt = {
  conn: ChannelConnectionSummary;
  name: string;
  step: "choose" | "confirmDelete";
};

function linkedListingsLabel(count: number): string {
  return count === 1 ? "1 linked listing" : `${count} linked listings`;
}

export function disconnectBaseMessage(name: string, linkedListings: number): string {
  const linked = linkedListingsLabel(linkedListings);
  return linkedListings > 0
    ? `You have ${linked} tied to ${name}. Sync will stop in both directions. Your listings on ${name} are not removed by INW.\n\nNWC is not responsible for inventory, oversells, or other business effects after you disconnect (see Terms of Service).`
    : `Your ${name} account will disconnect from INW Community. Any items you add later on INW will not sync to ${name} until you connect again.`;
}

export function disconnectDeleteConfirmMessage(
  name: string,
  linkedListings: number
): string {
  const linked = linkedListingsLabel(linkedListings);
  return `This permanently removes ${linked} from your INW storefront only. Listings on ${name} stay as they are.\n\nAfter disconnecting, you are responsible for inventory and sales on ${name} and any other channel. INW is not liable for tracking errors, oversells, or business loss from disconnecting a third-party store.`;
}

type Props = {
  prompt: DisconnectChannelPrompt | null;
  busy: boolean;
  onClose: () => void;
  onKeepOnInw: () => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onDisconnectNoLinks: () => void;
};

export function DisconnectChannelModal({
  prompt,
  busy,
  onClose,
  onKeepOnInw,
  onRequestDelete,
  onConfirmDelete,
  onDisconnectNoLinks,
}: Props) {
  if (!prompt) return null;

  const { conn, name, step } = prompt;
  const hasLinks = conn.linkedListings > 0;

  if (step === "confirmDelete") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disconnect-delete-title"
      >
        <div className="w-full max-w-md rounded-xl border-2 border-[var(--color-primary)] bg-white p-5 shadow-xl">
          <h2 id="disconnect-delete-title" className="text-lg font-bold mb-3">
            Delete from INW Community?
          </h2>
          <p className="text-sm text-gray-600 whitespace-pre-wrap mb-6">
            {disconnectDeleteConfirmMessage(name, conn.linkedListings)}
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
              onClick={onConfirmDelete}
              disabled={busy}
              className="rounded-lg border-2 border-red-700 bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {busy ? "Disconnecting…" : "Delete from INW"}
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
      <div className="w-full max-w-md rounded-xl border-2 border-[var(--color-primary)] bg-white p-5 shadow-xl">
        <h2 id="disconnect-title" className="text-lg font-bold mb-3">
          Disconnect {name}?
        </h2>
        <p className="text-sm text-gray-600 whitespace-pre-wrap mb-6">
          {disconnectBaseMessage(name, conn.linkedListings)}
        </p>
        {hasLinks ? (
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onKeepOnInw}
              disabled={busy}
              className="w-full rounded-lg border-2 border-[var(--color-primary)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-primary)] hover:bg-gray-50 disabled:opacity-50"
            >
              {busy ? "Disconnecting…" : "Keep on INW"}
            </button>
            <button
              type="button"
              onClick={onRequestDelete}
              disabled={busy}
              className="w-full rounded-lg border-2 border-red-700 bg-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              Delete from INW
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="w-full rounded-lg border-2 border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
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
