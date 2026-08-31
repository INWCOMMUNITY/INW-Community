"use client";

import { useState } from "react";
import Link from "next/link";
import { useLockBodyScroll } from "@/lib/scroll-lock";
import { endOnInwConfirm, endOnInwResult, uniqueLinkedShopNames } from "@/lib/store-item-ended-status";
import { CHANNEL_PROVIDER_LABELS } from "@/lib/channels/provider-ui";
import {
  channelNotReadyHint,
  listOnConnections,
  type ChannelConnectionSummary,
  type ChannelProviderId,
} from "@/lib/channel-connections-client";
import { BulkDestinationGridModal } from "@/components/store-item/BulkDestinationGridModal";
import {
  summarizeBulkDestinations,
  type BulkDestinationsResultCounts,
  type DestinationAssignment,
} from "@/lib/store-item-bulk-destinations";
import {
  alertChannelPublishResult,
  alertChannelSyncFailures,
  buildPublishResultAlert,
  isChannelPublishOk,
} from "@/lib/channel-sync-feedback";
import type { ChannelActionResult } from "@/components/store-item/ChannelActionResultModal";
import { itemEditHref, itemListingHref, type ItemsTab, type MyStoreItem } from "@/components/store-item/my-items-types";
import { ListOnChannelCategoryModal } from "@/components/store-item/ListOnChannelCategoryModal";
import {
  isListOnCategoryProvider,
  itemNeedsListOnCategoryStep,
  type ListOnCategoryAssignment,
  type ListOnCategoryProvider,
} from "@/lib/list-on-channel-category";

const menuRowClass =
  "flex w-full items-center px-5 py-3 text-sm font-semibold text-left no-underline hover:bg-gray-50 disabled:opacity-50";

function MenuDivider() {
  return <div className="h-px bg-gray-200" role="separator" />;
}

export function MyItemsRowMenu({
  item,
  tab,
  connections,
  onClose,
  onDone,
  onViewHistory,
  onActionResult,
}: {
  item: MyStoreItem;
  tab: ItemsTab;
  connections: ChannelConnectionSummary[];
  onClose: () => void;
  onDone: () => void;
  onViewHistory: () => void;
  onActionResult?: (result: ChannelActionResult) => void;
}) {
  const [acting, setActing] = useState(false);
  const [actingLabel, setActingLabel] = useState<string | null>(null);
  const [soldPrompt, setSoldPrompt] = useState(false);
  const [endGridOpen, setEndGridOpen] = useState(false);
  const [categoryProvider, setCategoryProvider] = useState<ListOnCategoryProvider | null>(null);
  useLockBodyScroll(true);

  const linked = (item.channelLinks ?? []).map((l) => l.provider as ChannelProviderId);
  const linkedSet = new Set(linked);
  const listCandidates =
    tab === "sold"
      ? []
      : connections.filter(
          (c) => (c.status === "active" || c.status === "error") && !linkedSet.has(c.provider)
        );
  const listable = listCandidates
    .filter((c) => c.status === "active" && c.readyToPublish !== false)
    .map((c) => c.provider);
  const listBlocked = listCandidates.filter(
    (c) => c.status !== "active" || c.readyToPublish === false
  );

  async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, { credentials: "include", ...init });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        (data as { detail?: string; error?: string }).detail ??
          (data as { error?: string }).error ??
          `Request failed (${res.status})`
      );
    }
    return data as T;
  }

  async function markSold(unpublishProviders?: ChannelProviderId[]) {
    setActing(true);
    try {
      const body: { status: "sold_out"; unpublishChannelProviders?: ChannelProviderId[] } = {
        status: "sold_out",
      };
      if (unpublishProviders?.length) body.unpublishChannelProviders = unpublishProviders;
      const data = await jsonFetch<{ channelSync?: { provider: string; ok: boolean; error?: string }[] }>(
        `/api/store-items/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      alertChannelSyncFailures(data.channelSync, unpublishProviders?.length ? "removed" : "saved");
      onDone();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to mark as sold");
    } finally {
      setActing(false);
      setSoldPrompt(false);
    }
  }

  async function endListingOnInw() {
    const shopNames = uniqueLinkedShopNames([item], CHANNEL_PROVIDER_LABELS);
    if (!window.confirm(endOnInwConfirm(1, shopNames))) return;
    setActing(true);
    try {
      await jsonFetch(`/api/store-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "inactive", syncToChannels: false }),
      });
      const summary = endOnInwResult(1, 0, shopNames);
      if (onActionResult) onActionResult(summary);
      else alert(summary.message);
      onDone();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to end listing");
    } finally {
      setActing(false);
    }
  }

  async function applyEndDestinations(assignments: DestinationAssignment[]) {
    setActing(true);
    try {
      const result = await jsonFetch<BulkDestinationsResultCounts>("/api/store-items/bulk-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end", items: assignments }),
      });
      const summary = summarizeBulkDestinations("end", result);
      if (onActionResult) onActionResult(summary);
      else alert(summary.message);
      onDone();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to end listing";
      if (onActionResult) onActionResult({ title: "End Listings failed", message: msg, ok: false });
      else alert(msg);
    } finally {
      setActing(false);
    }
  }

  async function deleteItem() {
    if (
      !window.confirm(
        "This permanently deletes the listing from the storefront. To keep a record and allow relisting later, use Mark as sold instead."
      )
    ) {
      return;
    }
    setActing(true);
    try {
      const data = await jsonFetch<{ channelSync?: { provider: string; ok: boolean; error?: string }[] }>(
        `/api/store-items/${item.id}`,
        { method: "DELETE" }
      );
      alertChannelSyncFailures(data.channelSync, "deleted");
      onDone();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setActing(false);
    }
  }

  async function relistItem() {
    if (!window.confirm("Relist this item with a quantity of 1? You can edit the quantity after relisting.")) {
      return;
    }
    setActing(true);
    try {
      const data = await jsonFetch<{
        ok?: boolean;
        channelSync?: { provider: string; ok: boolean; error?: string }[];
        error?: string;
      }>("/api/store-items/bulk-relist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeItemIds: [item.id], quantity: 1, republishChannels: false }),
      });
      alertChannelSyncFailures(data.channelSync);
      onDone();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to relist");
    } finally {
      setActing(false);
    }
  }

  async function publishTo(provider: ChannelProviderId) {
    if (isListOnCategoryProvider(provider) && itemNeedsListOnCategoryStep(item, provider)) {
      setCategoryProvider(provider);
      return;
    }
    const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
    if (!window.confirm(`List on ${label}? This creates a listing on your connected ${label} store and keeps inventory in sync.`)) {
      return;
    }
    await runPublish(provider);
  }

  function showPublishResult(
    channelSync: { provider: string; ok: boolean; error?: string }[] | undefined
  ) {
    const alert = buildPublishResultAlert(channelSync);
    const result = { ...alert, ok: isChannelPublishOk(channelSync) };
    if (onActionResult) {
      onActionResult(result);
      return;
    }
    alertChannelPublishResult(channelSync);
  }

  async function runPublish(provider: ChannelProviderId, assignment?: ListOnCategoryAssignment) {
    const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
    setActing(true);
    setActingLabel(`Listing on ${label}…`);
    try {
      const body: Record<string, unknown> = { providers: [provider] };
      if (assignment?.etsyTaxonomyId != null) body.etsyTaxonomyId = assignment.etsyTaxonomyId;
      if (assignment?.ebayCategoryId != null) body.ebayCategoryId = assignment.ebayCategoryId;
      if (assignment?.etsyWhoMade) body.etsyWhoMade = assignment.etsyWhoMade;
      if (assignment?.etsyWhenMade) body.etsyWhenMade = assignment.etsyWhenMade;
      if (assignment?.aspects?.length) body.aspects = assignment.aspects;
      const data = await jsonFetch<{ channelSync?: { provider: string; ok: boolean; error?: string }[] }>(
        `/api/store-items/${item.id}/publish-channels`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      showPublishResult(data.channelSync);
      onDone();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : `Could not list on ${label}.`;
      if (onActionResult) {
        onActionResult({ title: "Could not list", message: msg, ok: false });
        onDone();
        onClose();
        return;
      }
      if (assignment) throw new Error(msg);
      alert(msg);
    } finally {
      setActing(false);
      setActingLabel(null);
    }
  }

  async function unpublishFrom(provider: ChannelProviderId) {
    const label = CHANNEL_PROVIDER_LABELS[provider] ?? provider;
    if (
      !window.confirm(
        `Remove from ${label}? This deletes the listing on your ${label} store and stops sync. The item stays on INW.`
      )
    ) {
      return;
    }
    setActing(true);
    try {
      const data = await jsonFetch<{ channelSync?: { provider: string; ok: boolean; error?: string }[] }>(
        `/api/store-items/${item.id}/unpublish-channels`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providers: [provider] }),
        }
      );
      alertChannelSyncFailures(data.channelSync, "removed");
      onDone();
      const failed = (data.channelSync ?? []).some((r) => !r.ok);
      if (!failed) onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : `Could not remove from ${label}.`);
    } finally {
      setActing(false);
    }
  }

  const listingHref = itemListingHref(item);
  const storeList = linked.map((p) => CHANNEL_PROVIDER_LABELS[p] ?? p).join(", ");

  if (categoryProvider) {
    return (
      <ListOnChannelCategoryModal
        steps={[{ item, provider: categoryProvider }]}
        onClose={() => setCategoryProvider(null)}
        onComplete={async (assignments) => {
          await runPublish(categoryProvider, assignments[0]);
        }}
      />
    );
  }

  if (endGridOpen) {
    return (
      <BulkDestinationGridModal
        action="end"
        items={[item]}
        connectedProviders={listOnConnections(connections).map((c) => c.provider)}
        loading={acting}
        onClose={() => setEndGridOpen(false)}
        onApply={(assignments) => applyEndDestinations(assignments)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[250] flex justify-center items-center p-6 bg-black/40"
      role="dialog"
      aria-label="Item actions"
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} disabled={acting} />
      {soldPrompt ? (
        <div
          className="relative z-10 w-full max-w-sm rounded-xl border bg-white shadow-xl p-5"
          style={{ borderColor: "var(--color-earth)" }}
        >
          <h3 className="text-base font-bold mb-2" style={{ color: "var(--color-heading)" }}>
            Mark as sold?
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            This item is synced to {storeList}. Remove the listing from {linked.length === 1 ? "that store" : "those stores"} too?
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={acting}
              onClick={() => void markSold()}
              className="btn text-sm"
            >
              Keep on stores
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={() => void markSold(linked)}
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white bg-red-700 hover:bg-red-800 disabled:opacity-50"
            >
              {linked.length === 1 ? `Remove from ${CHANNEL_PROVIDER_LABELS[linked[0]] ?? linked[0]}` : "Remove from all"}
            </button>
            <button type="button" disabled={acting} onClick={() => setSoldPrompt(false)} className="text-sm text-gray-600 py-2">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div
          className="relative z-10 w-full max-w-sm rounded-xl border bg-white shadow-xl overflow-hidden flex flex-col"
          style={{ borderColor: "var(--color-earth)" }}
        >
          <div className="px-5 py-3 border-b border-gray-200 bg-[var(--color-section-alt)]">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--color-heading)" }}>
              {item.title}
            </p>
            {acting && (
              <p className="text-xs text-gray-500 mt-0.5">{actingLabel ?? "Working…"}</p>
            )}
          </div>
          <div className="flex flex-col">
            {tab === "sold" && item.soldOrderId && (
              <Link
                href={`/seller-hub/orders/${item.soldOrderId}`}
                prefetch={false}
                className={menuRowClass}
                style={{ color: "var(--color-heading)" }}
              >
                View order
              </Link>
            )}
            <Link
              href={itemEditHref(item)}
              prefetch={false}
              className={menuRowClass}
              style={{ color: "var(--color-heading)" }}
            >
              Edit
            </Link>
            <Link
              href={listingHref}
              prefetch={false}
              className={menuRowClass}
              style={{ color: "var(--color-heading)" }}
            >
              View listing
            </Link>
            <button
              type="button"
              disabled={acting}
              onClick={() => {
                onViewHistory();
                onClose();
              }}
              className={menuRowClass}
              style={{ color: "var(--color-heading)" }}
            >
              View history
            </button>
            <MenuDivider />
            {(tab === "ended" || tab === "sold") && (
              <button type="button" disabled={acting} onClick={() => void relistItem()} className={`${menuRowClass} text-green-800`}>
                Relist item
              </button>
            )}
            {listable.map((provider) => (
              <button
                key={`list-${provider}`}
                type="button"
                disabled={acting}
                onClick={() => void publishTo(provider)}
                className={menuRowClass}
                style={{ color: "var(--color-heading)" }}
              >
                List on {CHANNEL_PROVIDER_LABELS[provider] ?? provider}
              </button>
            ))}
            {listBlocked.map((c) => {
              const provider = c.provider as ChannelProviderId;
              const reason =
                c.status !== "active"
                  ? "Reconnect in Sync Stores."
                  : c.publishBlockReason || channelNotReadyHint(provider);
              return (
                <button
                  key={`list-blocked-${provider}`}
                  type="button"
                  disabled
                  className={`${menuRowClass} cursor-not-allowed`}
                  title={reason}
                >
                  <span>
                    List on {CHANNEL_PROVIDER_LABELS[provider] ?? provider}
                    <span className="block text-xs font-normal text-gray-500">{reason}</span>
                  </span>
                </button>
              );
            })}
            {linked.map((provider) => (
              <button
                key={`unlink-${provider}`}
                type="button"
                disabled={acting}
                onClick={() => void unpublishFrom(provider)}
                className={`${menuRowClass} text-red-700`}
              >
                Remove from {CHANNEL_PROVIDER_LABELS[provider] ?? provider}
              </button>
            ))}
            {tab !== "sold" && (
              <button
                type="button"
                disabled={acting}
                onClick={() => {
                  if (linked.length === 0) {
                    if (window.confirm("Mark as sold? This moves the item to Sold.")) void markSold();
                    return;
                  }
                  setSoldPrompt(true);
                }}
                className={`${menuRowClass} text-green-800`}
              >
                Mark sold
              </button>
            )}
            {tab === "active" && (
              <button
                type="button"
                disabled={acting}
                onClick={() => {
                  if ((item.channelLinks ?? []).length > 0) {
                    setEndGridOpen(true);
                    return;
                  }
                  void endListingOnInw();
                }}
                className={menuRowClass}
                style={{ color: "var(--color-heading)" }}
              >
                End listing
              </button>
            )}
            <MenuDivider />
            <button type="button" disabled={acting} onClick={() => void deleteItem()} className={`${menuRowClass} text-red-700`}>
              Delete
            </button>
            <button
              type="button"
              disabled={acting}
              onClick={onClose}
              className={`${menuRowClass} text-gray-500 border-t border-gray-200`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
