import React, { useCallback, useState } from "react";
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
  readiness: string;
  contentHealth: string;
  inventoryHealth: string;
  issueCode: string | null;
  issueMessage: string | null;
};

type UiStatus = "Live" | "Unpublished" | "Needs attention" | "Syncing";

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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
      return { bg: "#ecfdf5", fg: "#065f46" };
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

export default function ShopifySellerScreen() {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [remount, setRemount] = useState<RemountStatus>(null);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<ListingRow | null>(null);

  const load = useCallback(() => {
    Promise.all([
      apiGet<{ connections: Connection[]; remount?: RemountStatus }>("/api/shopify/connection"),
      apiGet<{ shopDomain?: string | null; listings: ListingRow[] }>("/api/shopify/listings"),
    ])
      .then(([connBody, listBody]) => {
        const active = connBody.connections?.find((c) => c.status === "ACTIVE") ?? null;
        setConnection(active);
        setRemount(connBody.remount ?? null);
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

  const onView = async (row: ListingRow) => {
    setMenuFor(null);
    try {
      const body = await apiGet<{
        primaryUrl?: string | null;
        adminUrl?: string | null;
      }>(`/api/shopify/listings/${row.storeItemId}/view-url`);
      const url = body.primaryUrl || body.adminUrl;
      if (url) await Linking.openURL(url);
      else setError("Could not open Shopify product");
    } catch {
      setError("Could not open Shopify product");
    }
  };

  const onRemove = (storeItemId: string) => {
    setMenuFor(null);
    Alert.alert(
      "Remove from Apps Airport",
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

  const needsLocation = Boolean(
    connection && (!connection.primaryLocationId || connection.locationSelectionRequired)
  );

  const openListOnShopify = () => {
    const url = `${siteBase}/seller-hub/apps/shopify/sync`;
    router.push(`/web?url=${encodeURIComponent(url)}&title=${encodeURIComponent("List on Shopify")}` as never);
  };

  const openConnectionSettings = () => {
    const url = `${siteBase}/seller-hub/apps/shopify/settings`;
    router.push(
      `/web?url=${encodeURIComponent(url)}&title=${encodeURIComponent("Shopify settings")}` as never
    );
  };

  if (loading && listings.length === 0 && !connection) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const remountLine = remountCopy(remount);

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
      <Text style={styles.title}>Shopify</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {toast ? <Text style={styles.toast}>{toast}</Text> : null}

      <View style={styles.card}>
        {connection ? (
          <>
            <Text style={styles.cardTitle}>{connection.shopDomain}</Text>
            <Text style={styles.cardMeta}>
              Location: {connection.primaryLocationId ? "Selected" : "Needs selection"}
            </Text>
            {remountLine ? <Text style={styles.remount}>{remountLine}</Text> : null}
          </>
        ) : (
          <Text style={styles.cardMeta}>No active Shopify connection.</Text>
        )}
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
          onPress={
            !connection
              ? openConnectionSettings
              : needsLocation
                ? openConnectionSettings
                : openListOnShopify
          }
        >
          <Text style={styles.primaryBtnText}>
            {!connection
              ? "Connect Shopify"
              : needsLocation
                ? "Choose location"
                : "List on Shopify"}
          </Text>
        </Pressable>
        {connection ? (
          <Pressable onPress={openConnectionSettings}>
            <Text style={styles.link}>Connection settings</Text>
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.sectionTitle}>Synced listings</Text>
      {listings.length === 0 ? (
        <Text style={styles.hint}>
          No synced listings yet. List an INW item — Live means published on Online Store.
        </Text>
      ) : (
        listings.map((row) => {
          const status = listingUiStatus(row);
          const chip = statusChipStyle(status);
          const busy = busyId === row.storeItemId;
          return (
            <View key={row.storeItemId} style={styles.listCard}>
              <View style={styles.listHeader}>
                <Text style={styles.listTitle}>{row.title}</Text>
                <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                  <Text style={[styles.chipText, { color: chip.fg }]}>{status}</Text>
                </View>
              </View>
              <Text style={styles.listMeta}>{formatPrice(row.priceCents)}</Text>
              {row.issueMessage && status !== "Live" ? (
                <Text style={styles.issue}>{row.issueMessage}</Text>
              ) : null}
              <Pressable
                style={styles.manageBtn}
                disabled={busy}
                onPress={() => setMenuFor(row)}
              >
                <Text style={styles.manageBtnText}>{busy ? "Working…" : "Manage"}</Text>
              </Pressable>
            </View>
          );
        })
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
                  <Text style={styles.menuItem}>Edit in INW</Text>
                </Pressable>
                <Pressable onPress={() => void onView(menuFor)}>
                  <Text style={styles.menuItem}>View on Shopify</Text>
                </Pressable>
                <Pressable
                  onPress={() =>
                    void runAction(menuFor.storeItemId, "retry", undefined, "Retry queued")
                  }
                >
                  <Text style={styles.menuItem}>Retry sync</Text>
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
                <Pressable onPress={() => onRemove(menuFor.storeItemId)}>
                  <Text style={[styles.menuItem, styles.menuDanger]}>Remove…</Text>
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
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12, color: theme.colors.heading },
  error: { color: "#b91c1c", marginBottom: 8 },
  toast: {
    color: "#065f46",
    backgroundColor: "#ecfdf5",
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  card: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
  },
  cardTitle: { fontWeight: "700", fontSize: 16, color: theme.colors.heading },
  cardMeta: { fontSize: 14, color: "#444", marginTop: 4 },
  remount: { fontSize: 13, color: "#92400e", marginTop: 6 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  link: { color: theme.colors.primary, marginTop: 10, fontSize: 14 },
  sectionTitle: { fontSize: 17, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666" },
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
  issue: { fontSize: 12, color: "#92400e", marginTop: 6 },
  manageBtn: {
    marginTop: 10,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  manageBtnText: { color: theme.colors.heading, fontWeight: "600", fontSize: 14 },
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
