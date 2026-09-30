import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Linking,
  Modal,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type Connection = {
  id: string;
  shopDomain: string;
  status: string;
  primaryLocationId: string | null;
  inventoryReady: boolean;
  locationSelectionRequired: boolean;
};

type RemountStatus = {
  state: string;
  message: string | null;
  errorCode: string | null;
} | null;

type ListingRow = {
  storeItemId: string;
  shopifyProductId: string;
  title: string;
  priceCents: number;
  quantity?: number;
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  issueCode: string | null;
  issueMessage: string | null;
  inventoryDesiredAvailable?: number | null;
  inventoryAppliedAvailable?: number | null;
};

type UiStatus = "Live" | "Unpublished" | "Needs attention" | "Syncing";
type ConnUi = "connected" | "needs_attention" | "disconnected";
type FilterTab = "all" | UiStatus;

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function classifyConnection(conn: Connection | null): ConnUi {
  if (!conn || conn.status !== "ACTIVE") return "disconnected";
  if (conn.locationSelectionRequired || !conn.inventoryReady) return "needs_attention";
  return "connected";
}

function connectionStatusLabel(status: ConnUi): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "needs_attention":
      return "Needs attention";
    default:
      return "Not connected";
  }
}

function listingUiStatus(row: ListingRow): UiStatus {
  const code = String(row.issueCode ?? "");
  if (code === "UNPUBLISHED_ONLINE_STORE" || code === "UNPUBLISH_PARTIAL") return "Unpublished";
  if (
    row.readiness === "ACTION_REQUIRED" ||
    row.readiness === "CONNECTION_REQUIRED" ||
    row.contentHealth === "PAUSED" ||
    row.inventoryHealth === "PAUSED" ||
    row.contentHealth === "DEGRADED" ||
    row.inventoryHealth === "DEGRADED"
  ) {
    return "Needs attention";
  }
  if (row.readiness === "READY_TO_PUBLISH") return "Live";
  return "Syncing";
}

function statusChipStyle(status: UiStatus) {
  switch (status) {
    case "Live":
      return { bg: "#FDEDCC", fg: "#3E432F" };
    case "Unpublished":
      return { bg: "#f5f5f5", fg: "#404040" };
    case "Needs attention":
      return { bg: "#fffbeb", fg: "#92400e" };
    default:
      return { bg: "#f0f9ff", fg: "#0c4a6e" };
  }
}

function remountCopy(remount: RemountStatus): string | null {
  if (!remount?.state) return null;
  const state = remount.state.toUpperCase();
  if (state === "PENDING" || state === "RUNNING" || state === "RETRY_WAIT") {
    return "Restoring listings after reconnect…";
  }
  if (state === "DEAD") {
    return remount.message?.trim() || "Could not restore some listings after reconnect.";
  }
  return null;
}

function formatObservedQty(row: ListingRow): string {
  if (typeof row.inventoryAppliedAvailable === "number") {
    return String(row.inventoryAppliedAvailable);
  }
  if (typeof row.inventoryDesiredAvailable === "number") {
    return `— (desired ${row.inventoryDesiredAvailable})`;
  }
  return "—";
}

function shopifyAdminUrl(shopDomain: string | null | undefined, productId: string | null | undefined) {
  if (!shopDomain || !productId) return null;
  const domain = shopDomain.trim().toLowerCase();
  if (!domain.endsWith(".myshopify.com")) return null;
  const match = productId.match(/^gid:\/\/shopify\/Product\/(\d+)$/);
  if (!match) return null;
  return `https://${domain}/admin/products/${match[1]}`;
}

export default function ShopifySellerScreen() {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [remount, setRemount] = useState<RemountStatus>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<ListingRow | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");

  const load = useCallback(() => {
    Promise.all([
      apiGet<{ connections: Connection[]; remount?: RemountStatus }>("/api/shopify/connection"),
      apiGet<{ shopDomain?: string | null; listings: ListingRow[] }>("/api/shopify/listings"),
    ])
      .then(([connBody, listBody]) => {
        const active = connBody.connections?.find((c) => c.status === "ACTIVE") ?? null;
        setConnection(active);
        setRemount(connBody.remount ?? null);
        setShopDomain(listBody.shopDomain ?? active?.shopDomain ?? null);
        setListings(Array.isArray(listBody.listings) ? listBody.listings : []);
        setError(null);
      })
      .catch(() => setError("Could not load Shopify."))
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
    action: "retry" | "unpublish" | "remove",
    confirmDelete?: boolean,
    successMessage?: string
  ) => {
    setBusyId(storeItemId);
    setError(null);
    setMenuFor(null);
    try {
      await apiPost(`/api/shopify/listings/${storeItemId}/actions`, {
        action,
        confirmDelete: confirmDelete ?? false,
      });
      if (successMessage) setToast(successMessage);
      load();
    } catch (e: unknown) {
      setError((e as { error?: string }).error ?? "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const onViewShopify = async (row: ListingRow) => {
    setMenuFor(null);
    try {
      const body = await apiGet<{
        primaryUrl?: string | null;
        adminUrl?: string | null;
      }>(`/api/shopify/listings/${row.storeItemId}/view-url`);
      const url = body.primaryUrl || body.adminUrl || shopifyAdminUrl(shopDomain, row.shopifyProductId);
      if (url) await Linking.openURL(url);
      else setError("Could not open Shopify product");
    } catch {
      const fallback = shopifyAdminUrl(shopDomain, row.shopifyProductId);
      if (fallback) await Linking.openURL(fallback);
      else setError("Could not open Shopify product");
    }
  };

  const onOpenAdmin = async (row: ListingRow) => {
    setMenuFor(null);
    const url = shopifyAdminUrl(shopDomain, row.shopifyProductId);
    if (url) await Linking.openURL(url);
    else setError("Could not open Shopify Admin");
  };

  const onDeleteListing = (storeItemId: string) => {
    setMenuFor(null);
    Alert.alert(
      "Delete listing",
      "Unpublish from Online Store and remove the INW ↔ Shopify link. The product stays in Shopify Admin unless you choose delete.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove mapping only",
          onPress: () => void runAction(storeItemId, "remove", false, "Mapping removed"),
        },
        {
          text: "Remove + delete product",
          style: "destructive",
          onPress: () =>
            void runAction(storeItemId, "remove", true, "Mapping removed and product deleted"),
        },
      ]
    );
  };

  const openWeb = (path: string, title: string) => {
    const url = `${siteBase}${path}`;
    router.push(`/web?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}` as never);
  };

  const uiStatus = classifyConnection(connection);
  const canImport = uiStatus !== "disconnected";
  const canList = uiStatus === "connected";
  const remountLine = remountCopy(remount);

  const rowsWithStatus = useMemo(
    () => listings.map((row) => ({ row, status: listingUiStatus(row) })),
    [listings]
  );

  const counts = useMemo(() => {
    const base = {
      all: rowsWithStatus.length,
      Live: 0,
      Unpublished: 0,
      "Needs attention": 0,
      Syncing: 0,
    };
    for (const item of rowsWithStatus) base[item.status] += 1;
    return base;
  }, [rowsWithStatus]);

  const filtered = useMemo(() => {
    if (filter === "all") return rowsWithStatus;
    return rowsWithStatus.filter((item) => item.status === filter);
  }, [rowsWithStatus, filter]);

  const tabs: Array<{ id: FilterTab; label: string }> = [
    { id: "all", label: `All (${counts.all})` },
    { id: "Live", label: `Live (${counts.Live})` },
    { id: "Needs attention", label: `Needs attention (${counts["Needs attention"]})` },
    { id: "Unpublished", label: `Unpublished (${counts.Unpublished})` },
    { id: "Syncing", label: `Syncing (${counts.Syncing})` },
  ];

  if (loading && listings.length === 0 && !connection) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
        />
      }
    >
      <Text style={styles.title}>
        Shopify ({connectionStatusLabel(uiStatus)})
      </Text>
      <Text style={styles.subtitle}>
        Your INW listings on Shopify Online Store — Live means published and sellable.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {toast ? <Text style={styles.toast}>{toast}</Text> : null}

      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionBtn,
            !canImport && styles.actionBtnDisabled,
            pressed && canImport && { opacity: 0.85 },
          ]}
          disabled={!canImport}
          onPress={() => openWeb("/seller-hub/apps/shopify/import", "Import Listings")}
        >
          <Text style={styles.actionBtnText}>Import Listings</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionBtn,
            !canList && styles.actionBtnDisabled,
            pressed && canList && { opacity: 0.85 },
          ]}
          disabled={!canList}
          onPress={() => openWeb("/seller-hub/apps/shopify/sync", "List Items on Shopify")}
        >
          <Text style={styles.actionBtnText}>List Items on Shopify</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.85 }]}
          onPress={() => openWeb("/seller-hub/apps/shopify/settings", "Connection Settings")}
        >
          <Text style={styles.actionBtnText}>Connection Settings</Text>
        </Pressable>
      </View>

      {remountLine ? <Text style={styles.remount}>{remountLine}</Text> : null}

      <Text style={styles.sectionTitle}>Synced Listings</Text>
      <Text style={styles.summary}>
        {counts.Live} live · {counts["Needs attention"]} need attention · {counts.Unpublished}{" "}
        unpublished
      </Text>

      {listings.length === 0 ? (
        <Text style={styles.hint}>
          No synced listings yet. List an INW item — Live means published on Online Store.
        </Text>
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
            contentContainerStyle={styles.filterRow}
          >
            {tabs.map((tab) => {
              const active = filter === tab.id;
              return (
                <Pressable
                  key={tab.id}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setFilter(tab.id)}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {filtered.length === 0 ? (
            <Text style={styles.hint}>No listings in this filter.</Text>
          ) : (
            filtered.map(({ row, status }) => {
              const chip = statusChipStyle(status);
              const busy = busyId === row.storeItemId;
              const inwQty = typeof row.quantity === "number" ? row.quantity : "—";
              return (
                <View key={row.storeItemId} style={styles.listCard}>
                  <View style={styles.listHeader}>
                    <Text style={styles.listTitle}>{row.title}</Text>
                    <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                      <Text style={[styles.chipText, { color: chip.fg }]}>{status}</Text>
                    </View>
                  </View>
                  <Text style={styles.listMeta}>
                    Qty {inwQty} · {formatObservedQty(row)} · {formatPrice(row.priceCents)}
                  </Text>
                  <Text style={styles.syncedWith}>Synced with: INW, Shopify</Text>
                  {row.issueMessage && status !== "Live" ? (
                    <Text style={styles.issue}>{row.issueMessage}</Text>
                  ) : null}
                  <Pressable
                    style={[styles.manageBtn, busy && { opacity: 0.6 }]}
                    disabled={busy}
                    onPress={() => setMenuFor(row)}
                  >
                    <Text style={styles.manageBtnText}>{busy ? "Working…" : "Manage"}</Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </>
      )}

      <Modal visible={Boolean(menuFor)} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setMenuFor(null)}>
          <View style={styles.menuSheet}>
            {menuFor ? (
              <>
                <Text style={styles.menuTitle}>{menuFor.title}</Text>
                <Pressable
                  onPress={() => {
                    setMenuFor(null);
                    router.push(`/seller-hub/store/new?edit=${menuFor.storeItemId}` as never);
                  }}
                >
                  <Text style={styles.menuItem}>Edit Listing</Text>
                </Pressable>
                <Pressable onPress={() => onDeleteListing(menuFor.storeItemId)}>
                  <Text style={[styles.menuItem, styles.menuDanger]}>Delete Listing</Text>
                </Pressable>
                <Pressable onPress={() => void onViewShopify(menuFor)}>
                  <Text style={styles.menuItem}>View on Shopify</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMenuFor(null);
                    openWeb(
                      `/seller-hub/apps/shopify/listings/${menuFor.storeItemId}`,
                      "View on INW"
                    );
                  }}
                >
                  <Text style={styles.menuItem}>View on INW</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void runAction(menuFor.storeItemId, "retry", undefined, "Reload queued")
                  }
                >
                  <Text style={styles.menuItem}>Reload Sync</Text>
                </Pressable>
                <Pressable onPress={() => void onOpenAdmin(menuFor)}>
                  <Text style={styles.menuItem}>Open Shopify Admin</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    Alert.alert("Unpublish", "Remove from Online Store? Mapping stays.", [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Unpublish",
                        onPress: () =>
                          void runAction(
                            menuFor.storeItemId,
                            "unpublish",
                            undefined,
                            "Removed from Online Store"
                          ),
                      },
                    ])
                  }
                >
                  <Text style={styles.menuItem}>Unpublish</Text>
                </Pressable>
                <Pressable onPress={() => setMenuFor(null)}>
                  <Text style={styles.menuCancel}>Cancel</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.heading },
  subtitle: { fontSize: 14, color: "#666", marginTop: 6, marginBottom: 14 },
  error: { color: "#b91c1c", marginBottom: 8 },
  toast: {
    color: "#065f46",
    backgroundColor: "#ecfdf5",
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  actionsRow: { gap: 10, marginBottom: 12 },
  actionBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  actionBtnDisabled: { opacity: 0.45 },
  actionBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  statusDetail: { fontSize: 13, color: "#444", marginBottom: 6 },
  remount: { fontSize: 13, color: "#92400e", marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "700", marginTop: 10, color: theme.colors.heading },
  summary: { fontSize: 13, color: "#666", marginBottom: 10 },
  hint: { fontSize: 14, color: "#666" },
  filterScroll: { marginBottom: 12 },
  filterRow: { gap: 8, paddingRight: 8 },
  filterChip: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#fff",
  },
  filterChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  filterChipText: { fontSize: 12, fontWeight: "600", color: "#404040" },
  filterChipTextActive: { color: "#fff" },
  listCard: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  listTitle: { fontWeight: "600", fontSize: 15, color: theme.colors.heading, flex: 1 },
  chip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  chipText: { fontSize: 11, fontWeight: "700" },
  listMeta: { fontSize: 13, color: "#555", marginTop: 4 },
  syncedWith: { fontSize: 12, color: "#666", marginTop: 4 },
  issue: { fontSize: 12, color: "#92400e", marginTop: 6 },
  manageBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  manageBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  menuSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  menuTitle: {
    fontWeight: "700",
    fontSize: 16,
    marginBottom: 12,
    color: theme.colors.heading,
  },
  menuItem: { fontSize: 16, paddingVertical: 12, color: theme.colors.primary, fontWeight: "500" },
  menuDanger: { color: "#b91c1c" },
  menuCancel: { fontSize: 16, paddingVertical: 12, color: "#666", marginTop: 4 },
});
