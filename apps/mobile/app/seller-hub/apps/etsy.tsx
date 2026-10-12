import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { apiGet, apiPost } from "@/lib/api";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const ETSY_DASHBOARD_URL = "https://www.etsy.com/your/shops/me/dashboard";

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

function inwLivePath(row: Pick<ListingRow, "slug" | "storeItemId">): string {
  const slug = row.slug?.trim();
  return slug
    ? `/storefront/${slug}?from=etsy-sync`
    : `/seller-hub/store/new?edit=${row.storeItemId}`;
}

type UiStatus = "Live" | "Unpublished" | "Needs attention" | "Syncing";
type FilterTab = "all" | UiStatus;

function formatPrice(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function isPubliclyViewable(remoteListingState?: string | null): boolean {
  return String(remoteListingState ?? "").trim().toLowerCase() === "active";
}

function publicListingUrl(row: ListingRow): string | null {
  const id = String(row.etsyListingId ?? "").trim();
  if (!/^\d+$/.test(id)) return null;
  if (!isPubliclyViewable(row.remoteListingState)) return null;
  return `https://www.etsy.com/listing/${id}`;
}

function listingUiStatus(row: ListingRow): UiStatus {
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
  if (!isPubliclyViewable(row.remoteListingState)) {
    return row.readiness === "SYNCING" ? "Syncing" : "Needs attention";
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

export default function EtsySyncScreen() {
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
      apiGet<{ connections?: Connection[] }>("/api/etsy/connection"),
      apiGet<{ listings?: ListingRow[] }>("/api/etsy/listings"),
    ])
      .then(([connBody, listBody]) => {
        const active = connBody.connections?.find((c) => c.status === "ACTIVE") ?? null;
        setConnection(active);
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

  const openWeb = (path: string, title: string) => {
    const url = `${siteBase}${path}`;
    router.push(`/web?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}` as never);
  };

  const runAction = async (
    storeItemId: string,
    action: "retry" | "remove",
    confirmDelete?: boolean,
    successMessage?: string
  ) => {
    setBusyId(storeItemId);
    setError(null);
    setMenuFor(null);
    try {
      const body = await apiPost<{ message?: string | null }>(
        `/api/etsy/listings/${encodeURIComponent(storeItemId)}/actions`,
        { action, confirmDelete: confirmDelete ?? false }
      );
      setToast(body.message?.trim() || successMessage || "Updated");
      load();
    } catch (e: unknown) {
      setError((e as { error?: string }).error ?? "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  const onRemove = (row: ListingRow) => {
    setMenuFor(null);
    const etsyId = row.etsyListingId ? ` Etsy #${row.etsyListingId}.` : "";
    Alert.alert(
      "Remove from Etsy sync?",
      `Unlinks this INW listing from Etsy. Your INW listing stays.${etsyId} Deleting on Etsy is best-effort.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlink only",
          onPress: () => void runAction(row.storeItemId, "remove", false, "Unlinked from Etsy"),
        },
        {
          text: "Unlink + delete on Etsy",
          style: "destructive",
          onPress: () =>
            void runAction(row.storeItemId, "remove", true, "Unlinked and delete requested on Etsy"),
        },
      ]
    );
  };

  const onViewEtsy = async (row: ListingRow) => {
    setMenuFor(null);
    const url = publicListingUrl(row);
    if (!url) {
      Alert.alert(
        "View on Etsy",
        row.etsyListingId ? "Not live on Etsy yet." : "Not listed yet."
      );
      return;
    }
    await Linking.openURL(url);
  };

  const connected = Boolean(connection);
  const rowsWithStatus = useMemo(
    () => listings.map((row) => ({ row, status: listingUiStatus(row) })),
    [listings]
  );
  const counts = useMemo(() => {
    const base = { all: rowsWithStatus.length, Live: 0, Unpublished: 0, "Needs attention": 0, Syncing: 0 };
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
      <Text style={styles.title}>Etsy ({connected ? "Connected" : "Not connected"})</Text>
      <Text style={styles.subtitle}>
        INW listings linked to Etsy, plus any List on Etsy attempts that still need attention.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {toast ? <Text style={styles.toast}>{toast}</Text> : null}

      <View style={styles.actionsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionBtn,
            !connected && styles.actionBtnDisabled,
            pressed && connected && { opacity: 0.85 },
          ]}
          disabled={!connected}
          onPress={() => openWeb("/seller-hub/apps/etsy/import", "Import Listings")}
        >
          <Text style={styles.actionBtnText}>Import Listings</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionBtnGold,
            !connected && styles.actionBtnDisabled,
            pressed && connected && { opacity: 0.85 },
          ]}
          disabled={!connected}
          onPress={() => openWeb("/seller-hub/apps/etsy/sync", "List Items on Etsy")}
        >
          <Text style={styles.actionBtnText}>List Items on Etsy</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.actionBtnEarth,
            !connected && styles.actionBtnDisabled,
            pressed && connected && { opacity: 0.85 },
          ]}
          disabled={!connected}
          onPress={() => void Linking.openURL(ETSY_DASHBOARD_URL)}
        >
          <Text style={styles.actionBtnText}>Open Etsy Dashboard</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.85 }]}
          onPress={() => openWeb("/seller-hub/apps/etsy/settings", "Connection Settings")}
        >
          <Text style={styles.actionBtnText}>Connection Settings</Text>
        </Pressable>
      </View>

      {connected ? (
        <Text style={styles.statusDetail}>
          Connected to {connection?.shopName ?? `Shop #${connection?.shopId}`}.
          {listings.length > 0
            ? ` ${listings.length} linked listing${listings.length === 1 ? "" : "s"}.`
            : ""}
        </Text>
      ) : (
        <Text style={styles.hint}>
          Connect Etsy to see mapped listings and enable Import / List items.
        </Text>
      )}

      {connected && listings.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>List your first item on Etsy</Text>
          <Text style={styles.hint}>
            Import from your Etsy shop, or publish an INW listing with How it’s made completed.
          </Text>
        </View>
      ) : null}

      {listings.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Synced Listings</Text>
          <Text style={styles.summary}>
            {counts.Live} live · {counts["Needs attention"]} need attention · {counts.Unpublished}{" "}
            unpublished
          </Text>
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
              const qty = typeof row.quantity === "number" ? row.quantity : "—";
              const mapped = Boolean(row.etsyListingId);
              return (
                <View key={row.id} style={styles.listCard}>
                  <View style={styles.listHeader}>
                    <Pressable
                      onPress={() => openWeb(inwLivePath(row), row.title)}
                      style={{ flex: 1, paddingRight: 8 }}
                    >
                      <Text style={[styles.listTitle, { textDecorationLine: "underline" }]}>
                        {row.title}
                      </Text>
                    </Pressable>
                    <View style={[styles.chip, { backgroundColor: chip.bg }]}>
                      <Text style={[styles.chipText, { color: chip.fg }]}>{status}</Text>
                    </View>
                  </View>
                  <Text style={styles.listMeta}>
                    Qty {qty} · {formatPrice(row.priceCents)}
                  </Text>
                  <Text style={styles.syncedWith}>Synced with: INW, Etsy</Text>
                  {status !== "Live" && row.issueMessage ? (
                    <Text style={styles.issue}>{row.issueMessage}</Text>
                  ) : null}
                  {mapped ? (
                    <Pressable
                      style={[styles.manageBtn, busy && { opacity: 0.6 }]}
                      disabled={busy}
                      onPress={() => setMenuFor(row)}
                    >
                      <Text style={styles.manageBtnText}>{busy ? "Working…" : "Manage"}</Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      style={styles.manageBtn}
                      onPress={() => openWeb("/seller-hub/apps/etsy/sync", "List Items on Etsy")}
                    >
                      <Text style={styles.manageBtnText}>Retry list</Text>
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </>
      ) : null}

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
                <Pressable onPress={() => onRemove(menuFor)}>
                  <Text style={[styles.menuItem, styles.menuDanger]}>Remove from Etsy</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setMenuFor(null);
                    openWeb(inwLivePath(menuFor), "View on INW");
                  }}
                >
                  <Text style={styles.menuItem}>View on INW</Text>
                </Pressable>
                <Pressable onPress={() => void onViewEtsy(menuFor)}>
                  <Text style={styles.menuItem}>View on Etsy</Text>
                </Pressable>
                {!isPubliclyViewable(menuFor.remoteListingState) ? (
                  <>
                    <Pressable
                      onPress={() => {
                        setMenuFor(null);
                        openWeb("/seller-hub/apps/etsy/sync", "List Items on Etsy");
                      }}
                    >
                      <Text style={styles.menuItem}>Finish List on Etsy</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        void runAction(
                          menuFor.storeItemId,
                          "retry",
                          undefined,
                          "Retry publish queued"
                        )
                      }
                    >
                      <Text style={styles.menuItem}>Retry publish</Text>
                    </Pressable>
                  </>
                ) : null}
                <Pressable
                  onPress={() => {
                    setMenuFor(null);
                    void Linking.openURL(ETSY_DASHBOARD_URL);
                  }}
                >
                  <Text style={styles.menuItem}>Open Etsy Shop Manager</Text>
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
  actionBtnGold: {
    backgroundColor: theme.colors.gold,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  actionBtnEarth: {
    backgroundColor: theme.colors.earth,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  actionBtnDisabled: { opacity: 0.45 },
  actionBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  statusDetail: { fontSize: 13, color: "#444", marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "700", marginTop: 10, color: theme.colors.heading },
  summary: { fontSize: 13, color: "#666", marginBottom: 10 },
  hint: { fontSize: 14, color: "#666", marginTop: 6 },
  emptyCard: {
    marginTop: 12,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: theme.colors.primary,
    borderRadius: 10,
    padding: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.heading },
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
