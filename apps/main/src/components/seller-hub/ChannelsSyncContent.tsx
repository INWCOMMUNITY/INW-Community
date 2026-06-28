"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";
import {
  CHANNEL_PROVIDERS_UI,
  formatChannelQueryError,
  type ChannelConnectionSummary,
} from "@/lib/channels/provider-ui";
import { EBAY_SIGN_OUT_URL } from "@/lib/channels/ebay/config";

export function ChannelsSyncContent() {
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<ChannelConnectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [shopifyShop, setShopifyShop] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/channels", { credentials: "include" });
      const data = await res.json();
      setConnections(Array.isArray(data) ? data : []);
    } catch {
      setConnections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const connected = searchParams.get("connected");
    const channelError = searchParams.get("channel_error");
    if (connected) {
      setSuccess(`${connected.charAt(0).toUpperCase()}${connected.slice(1)} connected.`);
      setError(null);
      void refresh();
    }
    if (channelError) {
      setError(formatChannelQueryError(channelError));
    }
  }, [searchParams, refresh]);

  const connectionFor = (provider: string) =>
    connections.find((c) => c.provider === provider && c.status !== "disconnected");

  const runDisconnect = async (conn: ChannelConnectionSummary, name: string, deleteInwItems: boolean) => {
    setBusy(conn.id);
    try {
      const qs = deleteInwItems ? "?deleteInwItems=1" : "";
      const res = await fetch(`/api/channels/${conn.id}${qs}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Could not disconnect. Try again.");
        return;
      }
      if (deleteInwItems) {
        const n = (data as { deletedInwCount?: number }).deletedInwCount ?? 0;
        setSuccess(
          `${name} disconnected. ${n} listing${n === 1 ? "" : "s"} removed from INW Community. Your ${name} store is unchanged.`
        );
      } else {
        setSuccess(`${name} disconnected. Your INW listings are unchanged.`);
      }
      setError(null);
      await refresh();
    } catch {
      setError("Could not disconnect. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = (conn: ChannelConnectionSummary, name: string) => {
    const linked =
      conn.linkedListings === 1
        ? "1 linked listing"
        : `${conn.linkedListings} linked listings`;
    const baseMessage =
      conn.linkedListings > 0
        ? `You have ${linked} tied to ${name}. Sync will stop in both directions. Your listings on ${name} are not removed by INW.\n\nNWC is not responsible for inventory, oversells, or other business effects after you disconnect (see Terms of Service).`
        : `Your ${name} account will disconnect from INW Community. Any items you add later on INW will not sync to ${name} until you connect again.`;

    if (!window.confirm(`Disconnect ${name}?\n\n${baseMessage}`)) return;

    if (conn.linkedListings === 0) {
      void runDisconnect(conn, name, false);
      return;
    }

    const keep = window.confirm(
      `Keep INW listings?\n\nOK = Keep listings on INW\nCancel = Choose whether to delete from INW`
    );
    if (keep) {
      void runDisconnect(conn, name, false);
      return;
    }

    if (
      window.confirm(
        `Delete from INW Community?\n\nThis permanently removes ${linked} from your INW storefront only. Listings on ${name} stay as they are.\n\nAfter disconnecting, you are responsible for inventory and sales on ${name} and any other channel.`
      )
    ) {
      void runDisconnect(conn, name, true);
    }
  };

  const testWix = async () => {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/channels/wix/health", { credentials: "include" });
      const r = await res.json();
      if (r.ok) {
        const parts = [
          `${r.productCount ?? 0} product(s) on Wix`,
          `${r.linkedCount ?? 0} linked on INW`,
          r.catalogApi ? `catalog ${r.catalogApi}` : null,
        ].filter(Boolean);
        setSuccess(`Wix OK — ${parts.join(" · ")}.`);
        if (r.syncErrors?.length) {
          setError(
            r.syncErrors.map((e: { title: string; error: string | null }) => `${e.title}: ${e.error ?? "sync error"}`).join("\n")
          );
        }
      } else {
        setError(r.listError || r.message || r.hint || "Wix test failed.");
      }
    } catch {
      setError("Could not test Wix connection.");
    }
  };

  const testWixPush = async () => {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/channels/wix/test-push", {
        method: "POST",
        credentials: "include",
      });
      const r = await res.json();
      if (r.ok && r.writeOk) {
        setSuccess(
          `Wix write OK${r.title ? ` (“${String(r.title).slice(0, 40)}”)` : ""} — qty ${r.readBefore?.quantity ?? "?"} → ${r.readAfter?.quantity ?? r.targetQty ?? "?"}.`
        );
      } else {
        setError(r.error || r.message || "Wix write test failed. Import a linked product first.");
      }
    } catch {
      setError("Could not test Wix write.");
    }
  };

  const btnOutline =
    "inline-flex items-center justify-center w-full rounded-lg border-2 border-[var(--color-primary)] bg-white py-3 text-[15px] font-semibold text-[var(--color-primary)] hover:opacity-90 transition-opacity disabled:opacity-50";
  const btnPrimary =
    "inline-flex items-center justify-center w-full rounded-lg border-2 border-[var(--color-primary)] py-3 text-[15px] font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50";
  const btnLink = "text-sm font-medium text-red-700 hover:underline py-2";

  return (
    <div className="max-w-2xl mx-auto min-w-0">
      <Link
        href="/seller-hub"
        className="text-sm text-gray-600 hover:underline mb-4 inline-block"
      >
        ← Back to Seller Hub
      </Link>
      <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-heading)" }}>
        Sync Stores
      </h1>
      <p className="text-gray-600 mb-6">
        List once on INW and keep your items and inventory in sync across marketplaces. A sale on any
        connected store reduces stock everywhere.
      </p>

      {loading ? (
        <p className="text-gray-500 py-8 text-center">Loading connections…</p>
      ) : (
        <div className="space-y-4">
          {CHANNEL_PROVIDERS_UI.map((p) => {
            const conn = connectionFor(p.provider);
            return (
              <div
                key={p.provider}
                className="rounded-xl border-2 border-[var(--color-primary)] p-4 sm:p-5 bg-white"
              >
                <div className="flex items-center gap-2 mb-2">
                  <IonIcon name={p.icon} size={22} className="text-[var(--color-primary)] shrink-0" />
                  <h2 className="text-lg font-bold">{p.name}</h2>
                </div>
                <p className="text-sm text-gray-600 mb-4">{p.blurb}</p>

                {conn ? (
                  <>
                    <div className="rounded-lg bg-green-50 border border-green-200 p-3 mb-4 text-sm">
                      <p className="font-semibold text-green-800">
                        Connected{conn.shopName ? ` to ${conn.shopName}` : ""}.
                      </p>
                      <p className="text-gray-600 mt-1">
                        {conn.linkedListings} listing{conn.linkedListings === 1 ? "" : "s"} linked.
                      </p>
                      {p.provider === "etsy" && !conn.hasShippingProfile && (
                        <p className="text-amber-800 mt-2">
                          Add a shipping profile on Etsy so listings can publish live.
                        </p>
                      )}
                      {p.provider === "ebay" && conn.readyToPublish === false && (
                        <p className="text-amber-800 mt-2">
                          Add eBay business policies (payment, return, shipping) and a merchant location
                          so listings can publish live.
                        </p>
                      )}
                      {p.provider === "wix" && (
                        <>
                          <p className="text-amber-800 mt-2">
                            Make sure the Wix Stores app is added to your site. Only items imported from
                            Wix (or created with sync on) push changes back to Wix.
                          </p>
                          {conn.linkedListings === 0 && (
                            <p className="text-amber-800 mt-1">
                              No listings linked yet — use Import existing listings.
                            </p>
                          )}
                        </>
                      )}
                      {p.provider === "shopify" && conn.readyToPublish === false && (
                        <p className="text-amber-800 mt-2">
                          Reconnect Shopify or set an inventory location so quantity sync can run.
                        </p>
                      )}
                      {p.provider === "shopify" && conn.readyToPublish !== false && (
                        <p className="text-amber-800 mt-2">
                          Your Shopify store needs the Online Store channel and inventory tracking enabled
                          for products to sync.
                        </p>
                      )}
                      {conn.status === "error" && conn.lastError && (
                        <p className="text-amber-800 mt-2">Sync issue: {conn.lastError}</p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <Link
                        href={`/seller-hub/channels/import?provider=${p.provider}`}
                        className={btnOutline}
                      >
                        Import existing listings
                      </Link>
                      {p.provider === "wix" && (
                        <>
                          <button type="button" onClick={() => void testWix()} className={btnOutline}>
                            Test Wix connection
                          </button>
                          <button type="button" onClick={() => void testWixPush()} className={btnOutline}>
                            Test Wix write (qty push)
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => disconnect(conn, p.name)}
                        disabled={busy === conn.id}
                        className={btnLink}
                      >
                        {busy === conn.id ? "Disconnecting…" : `Disconnect ${p.name}`}
                      </button>
                      {p.provider === "ebay" && (
                        <button
                          type="button"
                          className={btnOutline}
                          onClick={() => {
                            const name = conn.shopName || conn.shopId || "eBay";
                            if (
                              window.confirm(
                                `Logout of ${name}?\n\nThis only clears the eBay browser session. Your INW ↔ eBay sync keeps running until you Disconnect.\n\nSign-out lets you reconnect a different eBay account next time.`
                              )
                            ) {
                              window.open(EBAY_SIGN_OUT_URL, "_blank", "noopener,noreferrer");
                            }
                          }}
                        >
                          Logout of {conn.shopName || conn.shopId || "eBay"}
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {p.provider === "shopify" && (
                      <label className="block mb-3">
                        <span className="text-sm text-gray-600 block mb-1">
                          Shopify store domain
                        </span>
                        <input
                          type="text"
                          value={shopifyShop}
                          onChange={(e) => setShopifyShop(e.target.value)}
                          placeholder="mystore or mystore.myshopify.com"
                          className="w-full border-2 border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-[var(--color-primary)] outline-none"
                          autoCapitalize="off"
                          autoCorrect="off"
                        />
                      </label>
                    )}
                    {p.provider === "shopify" ? (
                      <a
                        href={
                          shopifyShop.trim()
                            ? `/api/channels/shopify/connect?shop=${encodeURIComponent(shopifyShop.trim())}`
                            : "#"
                        }
                        className={`${btnPrimary} ${!shopifyShop.trim() ? "pointer-events-none opacity-50" : ""}`}
                        style={{ backgroundColor: "var(--color-primary)" }}
                        onClick={(e) => {
                          if (!shopifyShop.trim()) {
                            e.preventDefault();
                            setError("Enter your Shopify store domain (e.g. mystore or mystore.myshopify.com).");
                          }
                        }}
                      >
                        Connect Shopify
                      </a>
                    ) : (
                      <a
                        href={`/api/channels/${p.provider}/connect`}
                        className={btnPrimary}
                        style={{ backgroundColor: "var(--color-primary)" }}
                      >
                        Connect {p.name}
                      </a>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {success && !error ? (
        <p className="mt-6 text-sm font-medium text-green-800 whitespace-pre-wrap">{success}</p>
      ) : null}
      {error ? (
        <p className="mt-6 text-sm font-medium text-red-700 whitespace-pre-wrap">{error}</p>
      ) : null}
    </div>
  );
}
