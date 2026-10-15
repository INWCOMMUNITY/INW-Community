import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { HubButton, airportStyles as styles } from "@/components/apps-airport/chrome";

type StockModePolicy = "RECOMMENDED" | "PHYSICAL" | "MADE_TO_ORDER";
type Step = "discover" | "shipping";

type BatchProgress = {
  state: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
  total: number;
  completed: number;
  failed: number;
  skipped: number;
  processed: number;
  remaining: number;
};

export type ImportCandidate = {
  id: string;
  title: string;
  supported: boolean;
  unsupportedReason: string | null;
  priceCents: number | null;
  recommendedStockMode: "PHYSICAL" | "MADE_TO_ORDER" | null;
};

type Props = {
  channel: "shopify" | "etsy";
  doneHref: string;
};

const MAX_SHIPPING_CENTS = 10_000_000;

function errMessage(e: unknown, fallback: string) {
  return (e as { error?: string }).error || fallback;
}

/** Dollars typed by the seller, such as "12.50". Blank is unset. */
function parseSellerShippingDollars(raw: string): number | null {
  const trimmed = raw.trim().replace(/^\$/, "");
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const cents = Math.round(Number(trimmed) * 100);
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_SHIPPING_CENTS) return null;
  return cents;
}

function priceLabel(cents: number | null) {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

export function ImportListingsScreen({ channel, doneHref }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [policy, setPolicy] = useState<StockModePolicy>("RECOMMENDED");
  const [step, setStep] = useState<Step>("discover");
  const [shippingItems, setShippingItems] = useState<ImportCandidate[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [priceById, setPriceById] = useState<Record<string, string>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [batch, setBatch] = useState<BatchProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const base = channel === "shopify" ? "/api/shopify/import" : "/api/etsy/import";

  const loadBatch = useCallback(async () => {
    try {
      const body = await apiGet<{ batch?: BatchProgress | null }>(`${base}/batch`);
      setBatch(body.batch ?? null);
    } catch {
      /* ignore poll errors */
    }
  }, [base]);

  const loadPage = useCallback(
    async (token: string | null, append: boolean) => {
      setError(null);
      setConnectionError(null);
      try {
        const path =
          channel === "shopify"
            ? `/api/shopify/import/candidates${token ? `?cursor=${encodeURIComponent(token)}` : ""}`
            : `/api/etsy/import/candidates?offset=${encodeURIComponent(token ?? "0")}`;
        const body = await apiGet<{
          error?: string;
          code?: string;
          candidates?: Array<Record<string, unknown>>;
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null; offset?: number };
        }>(path);
        const rows = (body.candidates ?? []).map((row) => ({
          id: String(channel === "shopify" ? row.shopifyProductId : row.etsyListingId),
          title: String(row.title ?? "Listing"),
          supported: row.supported !== false,
          unsupportedReason: typeof row.unsupportedReason === "string" ? row.unsupportedReason : null,
          priceCents: typeof row.priceCents === "number" ? row.priceCents : null,
          recommendedStockMode:
            row.recommendedStockMode === "PHYSICAL" || row.recommendedStockMode === "MADE_TO_ORDER"
              ? row.recommendedStockMode
              : null,
        }));
        setItems((prev) => (append ? [...prev, ...rows] : rows));
        setHasMore(Boolean(body.pageInfo?.hasNextPage));
        setPageToken(
          channel === "shopify"
            ? body.pageInfo?.endCursor ?? null
            : body.pageInfo?.offset != null
              ? String(body.pageInfo.offset)
              : null
        );
      } catch (e) {
        const err = e as { error?: string; status?: number };
        const message = err.error ?? "Could not load listings.";
        if (/connect|location|author/i.test(message)) setConnectionError(message);
        else setError(message);
        if (!append) setItems([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [channel]
  );

  useEffect(() => {
    void loadPage(null, false);
    void loadBatch();
  }, [loadPage, loadBatch]);

  const batchActive = batch?.state === "PENDING" || batch?.state === "RUNNING";

  useEffect(() => {
    if (!batchActive) return;
    const timer = setInterval(() => void loadBatch(), 2500);
    return () => clearInterval(timer);
  }, [batchActive, loadBatch]);

  const selectable = items.filter((item) => item.supported);
  const allSelected = selectable.length > 0 && selected.size === selectable.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleChecked = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = () => items.filter((item) => item.supported && selected.has(item.id));

  const startImport = async (ids: string[], shippingPrices: Record<string, number>) => {
    setBusy(true);
    setError(null);
    try {
      const body =
        channel === "shopify"
          ? { stockModePolicy: policy, productIds: ids, shippingPrices }
          : { stockModePolicy: policy, listingIds: ids, shippingPrices };
      const res = await apiPost<{ batch?: BatchProgress }>(`${base}/batch`, body);
      setBatch(res.batch ?? null);
      setSelected(new Set());
      setStep("discover");
      setShippingItems([]);
      setChecked(new Set());
      setPriceById({});
      setBulkPrice("");
    } catch (e) {
      setError(errMessage(e, "Could not start import."));
    } finally {
      setBusy(false);
    }
  };

  const shipFree = (chosen: ImportCandidate[]) => {
    if (chosen.length === 0) {
      setError("Select the listings to import.");
      return;
    }
    const shippingPrices: Record<string, number> = {};
    for (const item of chosen) shippingPrices[item.id] = 0;
    void startImport(
      chosen.map((item) => item.id),
      shippingPrices
    );
  };

  const openShipping = () => {
    const chosen = selectedItems();
    if (chosen.length === 0) {
      setError("Select the listings to import.");
      return;
    }
    setError(null);
    setShippingItems(chosen);
    setChecked(new Set());
    setPriceById({});
    setBulkPrice("");
    setStep("shipping");
  };

  const applyBulkPrice = () => {
    const cents = parseSellerShippingDollars(bulkPrice);
    if (checked.size === 0) {
      setError("Check the listings that should share this shipping price.");
      return;
    }
    if (cents == null) {
      setError("Enter a shipping price to apply.");
      return;
    }
    const formatted = (cents / 100).toFixed(2);
    setPriceById((prev) => {
      const next = { ...prev };
      for (const id of checked) next[id] = formatted;
      return next;
    });
    setError(null);
  };

  const importWithPrices = () => {
    const shippingPrices: Record<string, number> = {};
    for (const item of shippingItems) {
      const cents = parseSellerShippingDollars(priceById[item.id] ?? "");
      if (cents == null) {
        setError("Enter a shipping price for every listing, or ship for free.");
        return;
      }
      shippingPrices[item.id] = cents;
    }
    void startImport(
      shippingItems.map((item) => item.id),
      shippingPrices
    );
  };

  const cancelBatch = async () => {
    setBusy(true);
    try {
      const res = await apiPost<{ batch?: BatchProgress }>(`${base}/batch/cancel`, {});
      setBatch(res.batch ?? null);
    } catch (e) {
      setError(errMessage(e, "Could not cancel import."));
    } finally {
      setBusy(false);
    }
  };

  if (loading && items.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const allChecked = shippingItems.length > 0 && checked.size === shippingItems.length;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void loadPage(null, false);
            void loadBatch();
          }}
        />
      }
    >
      {connectionError ? <Text style={styles.error}>{connectionError}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {batch ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Import {batch.state.toLowerCase()} · {batch.processed}/{batch.total || batch.processed}
          </Text>
          <Text style={styles.cardBody}>
            {batch.completed} imported · {batch.failed} failed · {batch.skipped} skipped
          </Text>
          {batchActive ? (
            <View style={{ marginTop: 12 }}>
              <HubButton label={busy ? "Cancelling…" : "Cancel import"} tone="earth" disabled={busy} onPress={() => void cancelBatch()} />
            </View>
          ) : batch.state === "COMPLETED" ? (
            <View style={{ marginTop: 12 }}>
              <HubButton label="Back to synced listings" onPress={() => router.replace(doneHref as never)} />
            </View>
          ) : null}
        </View>
      ) : null}

      {step === "discover" ? (
        <>
          <Text style={styles.subtitle}>
            Check the listings you want. The next page sets a shipping price for each one. Ship for free to
            import the checked listings now. INW does not sync shipping prices.
          </Text>

          <Text style={styles.label}>Stock mode</Text>
          <View style={styles.chipRow}>
            {(
              [
                ["RECOMMENDED", "Per Listing (Recommended)"],
                ["PHYSICAL", "Track inventory"],
                ["MADE_TO_ORDER", "Made to order"],
              ] as const
            ).map(([id, label]) => {
              const on = policy === id;
              return (
                <Pressable key={id} style={[styles.chip, on && styles.chipOn]} onPress={() => setPolicy(id)}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {items.length === 0 ? (
            <Text style={styles.hint}>No listings to import.</Text>
          ) : (
            <>
              <Pressable
                style={local.selectAll}
                disabled={batchActive || selectable.length === 0}
                onPress={() =>
                  setSelected(allSelected ? new Set() : new Set(selectable.map((item) => item.id)))
                }
              >
                <Text style={local.selectMark}>{allSelected ? "✓" : ""}</Text>
                <Text style={styles.listTitle}>Select all</Text>
              </Pressable>
              {items.map((item) => {
                const on = selected.has(item.id);
                return (
                  <Pressable
                    key={item.id}
                    style={[styles.listCard, on && { borderColor: theme.colors.primary }]}
                    disabled={!item.supported || batchActive}
                    onPress={() => toggle(item.id)}
                  >
                    <Text style={styles.listTitle}>
                      {on ? "✓ " : ""}
                      {item.title}
                    </Text>
                    <Text style={styles.meta}>
                      {priceLabel(item.priceCents)}
                      {item.recommendedStockMode
                        ? ` · ${item.recommendedStockMode === "MADE_TO_ORDER" ? "Made to order" : "Tracked"}`
                        : ""}
                    </Text>
                    {!item.supported && item.unsupportedReason ? (
                      <Text style={styles.issue}>{item.unsupportedReason}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </>
          )}

          {hasMore ? (
            <HubButton
              label="Load more"
              tone="earth"
              disabled={loading}
              onPress={() => void loadPage(pageToken, true)}
            />
          ) : null}

          {items.length > 0 ? (
            <View style={[styles.actions, { marginBottom: 16 }]}>
              <HubButton
                label="Set Shipping Prices"
                disabled={busy || batchActive || Boolean(connectionError)}
                onPress={openShipping}
              />
              <HubButton
                label={busy ? "Starting…" : "Ship for Free with INW (Appreciated)"}
                tone="earth"
                disabled={busy || batchActive || Boolean(connectionError)}
                onPress={() => shipFree(selectedItems())}
              />
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={local.heading}>Shipping prices</Text>
          <Text style={styles.subtitle}>
            Set what buyers pay to ship each listing on INW. Check listings to apply one price to all of them.
            INW does not sync shipping prices.
          </Text>

          <View style={local.bulkBox}>
            <Pressable
              style={local.selectAll}
              onPress={() =>
                setChecked(allChecked ? new Set() : new Set(shippingItems.map((item) => item.id)))
              }
            >
              <Text style={local.selectMark}>{allChecked ? "✓" : ""}</Text>
              <Text style={styles.listTitle}>Select all</Text>
            </Pressable>
            <Text style={styles.label}>Price for checked listings</Text>
            <View style={local.priceRow}>
              <Text style={local.dollar}>$</Text>
              <TextInput
                style={[styles.input, local.priceInput]}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#888"
                value={bulkPrice}
                onChangeText={setBulkPrice}
              />
            </View>
            <View style={{ marginTop: 10 }}>
              <HubButton label="Apply to selected" disabled={busy} onPress={applyBulkPrice} />
            </View>
          </View>

          {shippingItems.map((item) => {
            const on = checked.has(item.id);
            return (
              <View key={item.id} style={[styles.listCard, on && { borderColor: theme.colors.primary }]}>
                <Pressable style={local.selectAll} onPress={() => toggleChecked(item.id)}>
                  <Text style={local.selectMark}>{on ? "✓" : ""}</Text>
                  <Text style={styles.listTitle}>{item.title}</Text>
                </Pressable>
                <Text style={styles.label}>Shipping price</Text>
                <View style={local.priceRow}>
                  <Text style={local.dollar}>$</Text>
                  <TextInput
                    style={[styles.input, local.priceInput]}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#888"
                    value={priceById[item.id] ?? ""}
                    onChangeText={(value) => setPriceById((prev) => ({ ...prev, [item.id]: value }))}
                    accessibilityLabel={`Shipping price for ${item.title}`}
                  />
                </View>
              </View>
            );
          })}

          <View style={styles.actions}>
            <HubButton
              label={busy ? "Starting…" : "Import listings"}
              disabled={busy || batchActive}
              onPress={importWithPrices}
            />
            <HubButton
              label="Ship for Free with INW (Appreciated)"
              tone="earth"
              disabled={busy || batchActive}
              onPress={() => shipFree(shippingItems)}
            />
            <HubButton
              label="Back"
              tone="honey"
              disabled={busy}
              onPress={() => {
                setStep("discover");
                setError(null);
              }}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const local = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: "700", color: theme.colors.heading },
  selectAll: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  selectMark: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 4,
    textAlign: "center",
    lineHeight: 20,
    color: theme.colors.primary,
    fontWeight: "700",
  },
  bulkBox: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dollar: { fontSize: 16, color: "#111" },
  priceInput: { flex: 1, paddingVertical: 10 },
});
