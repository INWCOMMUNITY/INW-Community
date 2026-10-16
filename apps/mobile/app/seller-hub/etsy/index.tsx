import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { buildProductPath } from "@/lib/product-referrer";
import { HubButton, airportStyles as styles } from "@/components/apps-airport/chrome";
import { ListingPhotoCollage } from "@/components/apps-airport/ListingPhotoCollage";

type Connection = {
  id: string;
  shopId: string;
  shopName: string | null;
  status: string;
};

type ListingRow = {
  id: string;
  storeItemId: string;
  etsyListingId: string;
  title: string;
  slug?: string | null;
  photos?: string[];
  priceCents: number | null;
  quantity: number | null;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  issueCode: string | null;
  issueMessage: string | null;
  storeItemStatus: string | null;
  remoteListingState?: string | null;
};

type UiStatus = "Live" | "Unpublished" | "Needs attention" | "Syncing";
type FilterTab = "all" | UiStatus;

function etsyPublicUrl(row: ListingRow): string | null {
  const id = String(row.etsyListingId ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  if (String(row.remoteListingState ?? "").trim().toLowerCase() !== "active") return null;
  return `https://www.etsy.com/listing/${id}`;
}

function listingStatus(row: ListingRow): UiStatus {
  if (row.storeItemStatus === "ended" || row.storeItemStatus === "draft") return "Unpublished";
  if (
    row.readiness === "ACTION_REQUIRED" ||
    row.readiness === "CONNECTION_REQUIRED" ||
    row.contentHealth === "PAUSED" ||
    row.inventoryHealth === "PAUSED" ||
    row.contentHealth === "DEGRADED" ||
    row.inventoryHealth === "DEGRADED" ||
    Boolean(row.issueCode)
  ) {
    return "Needs attention";
  }
  const remoteActive = String(row.remoteListingState ?? "").trim().toLowerCase() === "active";
  if (!remoteActive) return row.readiness === "SYNCING" ? "Syncing" : "Needs attention";
  if (row.readiness === "READY_TO_PUBLISH") return "Live";
  return "Syncing";
}

function chipColors(status: UiStatus) {
  if (status === "Live") return { bg: "#FDEDCC", fg: "#3E432F" };
  if (status === "Unpublished") return { bg: "#f5f5f5", fg: "#404040" };
  if (status === "Needs attention") return { bg: "#fffbeb", fg: "#92400e" };
  return { bg: "#f0f9ff", fg: "#0c4a6e" };
}

function errMessage(e: unknown, fallback: string) {
  return (e as { error?: string }).error || fallback;
}

export default function EtsyHubScreen() {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<ListingRow | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");

  const load = useCallback(() => {
    Promise.all([
      apiGet<{ connections: Connection[] }>("/api/etsy/connection"),
      apiGet<{ listings: ListingRow[] }>("/api/etsy/listings"),
    ])
      .then(([connBody, listBody]) => {
        setConnection(connBody.connections?.find((c) => c.status === "ACTIVE") ?? null);
        setListings(Array.isArray(listBody.listings) ? listBody.listings : []);
        setError(null);
      })
      .catch(() => setError("Could not load Etsy."))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const runAction = async (
    storeItemId: string,
    action: "retry" | "reload" | "remove" | "end",
    confirmDelete?: boolean,
    success?: string
  ) => {
    setBusyId(storeItemId);
    setMenuFor(null);
    setError(null);
    try {
      const body = await apiPost<{ message?: string | null }>(
        `/api/etsy/listings/${encodeURIComponent(storeItemId)}/actions`,
        { action, ...(confirmDelete != null ? { confirmDelete } : {}) }
      );
      setToast(body.message?.trim() || success || "Updated");
      load();
    } catch (e) {
      setError(errMessage(e, "Action failed"));
    } finally {
      setBusyId(null);
    }
  };

  const rows = useMemo(
    () => listings.map((row) => ({ row, status: listingStatus(row) })),
    [listings]
  );
  const counts = useMemo(() => {
    const base = { all: rows.length, Live: 0, Unpublished: 0, "Needs attention": 0, Syncing: 0 };
    for (const item of rows) base[item.status] += 1;
    return base;
  }, [rows]);
  const filtered = filter === "all" ? rows : rows.filter((item) => item.status === filter);
  const connected = connection?.status === "ACTIVE";

  if (loading && listings.length === 0 && !connection) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const tabs: Array<{ id: FilterTab; label: string }> = [
    { id: "all", label: `All (${counts.all})` },
    { id: "Live", label: `Live (${counts.Live})` },
    { id: "Needs attention", label: `Needs attention (${counts["Needs attention"]})` },
    { id: "Unpublished", label: `Unpublished (${counts.Unpublished})` },
    { id: "Syncing", label: `Syncing (${counts.Syncing})` },
  ];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />
      }
    >
      <Text style={styles.title}>Etsy ({connected ? "Connected" : "Not connected"})</Text>
      <Text style={styles.subtitle}>
        Your INW listings on Etsy. Live means the Etsy listing is active and shoppers can buy it.
      </Text>
      {connection ? <Text style={styles.shopLine}>Shop: {connection.shopName ?? `#${connection.shopId}`}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {toast ? <Text style={styles.ok}>{toast}</Text> : null}
      <View style={styles.actions}>
        {connected ? (
          <>
            <HubButton
              label="Import Listings"
              onPress={() => router.push("/seller-hub/etsy/import" as never)}
            />
            <HubButton
              label="List Items on Etsy"
              tone="honey"
              onPress={() => router.push("/seller-hub/etsy/sync" as never)}
            />
            <HubButton
              label="Open Etsy Dashboard"
              tone="earth"
              onPress={() => void Linking.openURL("https://www.etsy.com/your/shops/me/dashboard")}
            />
          </>
        ) : null}
        <HubButton
          label="Settings"
          onPress={() => router.push("/seller-hub/etsy/settings" as never)}
        />
      </View>

      {!connected ? (
        <Text style={styles.hint}>Connect Etsy to see mapped listings and enable Import / List items.</Text>
      ) : listings.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>List your first item on Etsy</Text>
          <Text style={styles.cardBody}>
            Import from your Etsy shop, or publish an INW listing with How it’s made completed.
          </Text>
        </View>
      ) : (
        <>
          <Text style={styles.hint}>
            {counts.Live} live · {counts["Needs attention"]} need attention · {counts.Unpublished} unpublished
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={styles.chipRow}>
              {tabs.map((tab) => {
                const on = filter === tab.id;
                return (
                  <Pressable key={tab.id} style={[styles.chip, on && styles.chipOn]} onPress={() => setFilter(tab.id)}>
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{tab.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          {filtered.length === 0 ? <Text style={styles.hint}>No listings in this filter.</Text> : null}
          {filtered.map(({ row, status }) => {
            const chip = chipColors(status);
            const busy = busyId === row.storeItemId;
            return (
              <View key={row.id} style={styles.listCard}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <ListingPhotoCollage photos={row.photos} />
                  <View style={{ flex: 1 }}>
                <View style={styles.row}>
                  <Text style={styles.listTitle}>{row.title}</Text>
                  <View style={{ backgroundColor: chip.bg, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ color: chip.fg, fontSize: 12, fontWeight: "700" }}>{status}</Text>
                  </View>
                </View>
                <Text style={styles.meta}>
                  Qty {row.quantity ?? "—"} ·{" "}
                  {row.priceCents != null ? `$${(row.priceCents / 100).toFixed(2)}` : "—"}
                </Text>
                <Text style={styles.meta}>Synced with: INW, Etsy</Text>
                {status !== "Live" && row.issueMessage ? <Text style={styles.issue}>{row.issueMessage}</Text> : null}
                <Pressable
                  style={{ marginTop: 8 }}
                  disabled={busy}
                  onPress={() => setMenuFor(row)}
                >
                  <Text style={{ color: theme.colors.primary, fontWeight: "700" }}>
                    {busy ? "Working…" : "Manage"}
                  </Text>
                </Pressable>
                  </View>
                </View>
              </View>
            );
          })}
        </>
      )}

      <Modal visible={menuFor != null} transparent animationType="fade">
        <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" }} onPress={() => setMenuFor(null)}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 }}>
            {menuFor ? (
              <>
                <Text style={styles.cardTitle}>{menuFor.title}</Text>
                <MenuItem
                  label="Edit Listing"
                  onPress={() => {
                    setMenuFor(null);
                    router.push(`/seller-hub/store/new?edit=${menuFor.storeItemId}` as never);
                  }}
                />
                <MenuItem
                  label="Reload Sync"
                  onPress={() => void runAction(menuFor.storeItemId, "reload", undefined, "Reload queued")}
                />
                <MenuItem
                  label="Remove from Etsy"
                  danger
                  onPress={() => {
                    const id = menuFor.storeItemId;
                    setMenuFor(null);
                    Alert.alert(
                      "Remove from Etsy sync?",
                      "Unlinks this INW listing from Etsy. Your INW listing stays.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove link",
                          style: "destructive",
                          onPress: () => void runAction(id, "remove", false, "Removed from Etsy sync"),
                        },
                        {
                          text: "Remove and delete on Etsy",
                          style: "destructive",
                          onPress: () => void runAction(id, "remove", true, "Removed and deleted on Etsy"),
                        },
                      ]
                    );
                  }}
                />
                <MenuItem
                  label="Remove from INW"
                  onPress={() => {
                    const id = menuFor.storeItemId;
                    setMenuFor(null);
                    Alert.alert(
                      "Remove from INW?",
                      "Takes this listing off your INW storefront. It stays live on Etsy.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove from INW",
                          onPress: () => {
                            setBusyId(id);
                            void apiPatch(`/api/store-items/${id}`, { status: "inactive" })
                              .then(() => {
                                setToast("Removed from INW. It stays on Etsy.");
                                load();
                              })
                              .catch((e) => setError(errMessage(e, "Could not remove from INW")))
                              .finally(() => setBusyId(null));
                          },
                        },
                      ]
                    );
                  }}
                />
                <MenuItem
                  label="View on INW"
                  onPress={() => {
                    const slug = menuFor.slug?.trim();
                    setMenuFor(null);
                    if (slug) router.push(buildProductPath(slug, { type: "storefront" }) as never);
                    else router.push(`/seller-hub/store/new?edit=${menuFor.storeItemId}` as never);
                  }}
                />
                {etsyPublicUrl(menuFor) ? (
                  <MenuItem
                    label="View on Etsy"
                    onPress={() => {
                      const url = etsyPublicUrl(menuFor);
                      setMenuFor(null);
                      if (url) void Linking.openURL(url);
                    }}
                  />
                ) : (
                  <Text style={styles.hint}>
                    {menuFor.etsyListingId ? "Not live on Etsy yet" : "Not listed yet"}
                  </Text>
                )}
                {listingStatus(menuFor) !== "Live" ? (
                  <>
                    <MenuItem
                      label="Finish List on Etsy"
                      onPress={() => {
                        setMenuFor(null);
                        router.push("/seller-hub/etsy/sync" as never);
                      }}
                    />
                    <MenuItem
                      label="Retry publish"
                      onPress={() => void runAction(menuFor.storeItemId, "retry", undefined, "Retry queued")}
                    />
                  </>
                ) : null}
                <MenuItem label="View my items" onPress={() => { setMenuFor(null); router.push("/seller-hub/store/items" as never); }} />
                <MenuItem label="Cancel" onPress={() => setMenuFor(null)} />
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

function MenuItem({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 12 }}>
      <Text style={{ fontSize: 16, color: danger ? "#b91c1c" : "#111", fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
