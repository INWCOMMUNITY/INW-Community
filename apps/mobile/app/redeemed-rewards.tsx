import React, { useCallback, useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

type BusinessRow = { id: string; name: string; slug: string };

type RedemptionRow = {
  id: string;
  createdAt: string;
  pointsSpent: number;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
  notesToBusiness: string | null;
  shippingAddress: unknown;
  storeOrderId: string | null;
  fulfillmentStatus: string | null;
  reward: { id: string; title: string; needsShipping: boolean; imageUrl: string | null };
  memberId: string;
};

type ListPayload = {
  businessName: string;
  hasSellerPlan: boolean;
  redemptions: RedemptionRow[];
};

/** Production may 404 HTML on one path until deploy; try both JSON routes. */
async function fetchRewardRedemptionsForBusiness(businessId: string): Promise<ListPayload> {
  const paths = [
    `/api/businesses/${businessId}/reward-redemptions`,
    `/api/businesses/${businessId}/redemptions`,
  ] as const;
  let lastErr: unknown;
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    try {
      return await apiGet<ListPayload>(path);
    } catch (e) {
      lastErr = e;
      const err = e as { error?: string; status?: number };
      const msg = (err.error ?? "").toLowerCase();
      const tryNext =
        i < paths.length - 1 &&
        (msg.includes("web page") ||
          msg.includes("check your connection") ||
          msg.includes("try again later") ||
          err.status === 404 ||
          msg.includes("not found"));
      if (!tryNext) throw e;
    }
  }
  throw lastErr;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function RedeemedRewardsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ businessId?: string | string[] }>();
  const pushBusinessId =
    typeof params.businessId === "string"
      ? params.businessId
      : Array.isArray(params.businessId)
        ? params.businessId[0]
        : undefined;
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<ListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBusinesses = useCallback(async () => {
    const list = await apiGet<BusinessRow[]>("/api/businesses?mine=1").catch(() => []);
    const arr = Array.isArray(list) ? list : [];
    setBusinesses(arr);
    if (arr.length > 0) {
      setSelectedId((prev) => {
        if (prev) return prev;
        if (pushBusinessId && arr.some((b) => b.id === pushBusinessId)) return pushBusinessId;
        return arr[0].id;
      });
    }
  }, [pushBusinessId]);

  const loadRedemptions = useCallback(async () => {
    if (!selectedId) {
      setData(null);
      return;
    }
    setError(null);
    const res = await fetchRewardRedemptionsForBusiness(selectedId).catch((e) => {
      setError((e as { error?: string })?.error ?? "Failed to load.");
      return null;
    });
    if (res && typeof res === "object" && Array.isArray(res.redemptions)) {
      setData(res);
    } else {
      setData(null);
    }
  }, [selectedId]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setLoading(true);
      loadBusinesses()
        .then(() => {
          if (!cancelled) setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }, [loadBusinesses])
  );

  useEffect(() => {
    if (!selectedId) return;
    loadRedemptions();
  }, [selectedId, loadRedemptions]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadRedemptions().finally(() => setRefreshing(false));
  }, [loadRedemptions]);

  const pickBusiness = () => {
    if (businesses.length <= 1) return;
    Alert.alert(
      "Business",
      "Choose which business",
      [
        ...businesses.map((b) => ({
          text: b.name,
          onPress: () => setSelectedId(b.id),
        })),
        { text: "Cancel", style: "cancel" },
      ]
    );
  };

  if (loading && businesses.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (businesses.length === 0) {
    return (
      <View style={styles.container}>
        <Pressable style={styles.backRow} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Redeemed Rewards</Text>
        <Text style={styles.empty}>Set up a business page first to see reward redemptions.</Text>
      </View>
    );
  }

  const showShipCta = (r: RedemptionRow) =>
    data?.hasSellerPlan &&
    r.reward.needsShipping &&
    !!r.storeOrderId;

  return (
    <View style={styles.container}>
      <Pressable style={styles.backRow} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>Redeemed Rewards</Text>
      <Text style={styles.subtitle}>
        Members who redeemed points for your rewards. Contact them to fulfill the reward.
      </Text>

      <Pressable
        style={({ pressed }) => [styles.manageBtn, pressed && { opacity: 0.85 }]}
        onPress={() =>
          (router.push as (href: string) => void)("/business-hub-offered-rewards")
        }
      >
        <Ionicons name="settings-outline" size={18} color="#fff" />
        <Text style={styles.manageBtnText}>My Businesses Rewards</Text>
      </Pressable>

      {businesses.length > 1 ? (
        <Pressable style={styles.bizPicker} onPress={pickBusiness}>
          <Text style={styles.bizPickerLabel} numberOfLines={1}>
            {businesses.find((b) => b.id === selectedId)?.name ?? "Select business"}
          </Text>
          <Ionicons name="chevron-down" size={20} color={theme.colors.primary} />
        </Pressable>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {!data && selectedId ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <FlatList
          data={data?.redemptions ?? []}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.empty}>No redemptions yet.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{item.reward.title}</Text>
              <Text style={styles.cardMeta}>
                {item.pointsSpent} pts · {formatWhen(item.createdAt)}
              </Text>
              <Text style={styles.cardLabel}>Contact</Text>
              <Text style={styles.cardValue}>{item.contactName}</Text>
              {item.contactEmail ? (
                <Pressable
                  onPress={() => Linking.openURL(`mailto:${item.contactEmail}`)}
                  style={styles.linkRow}
                >
                  <Ionicons name="mail-outline" size={18} color={theme.colors.primary} />
                  <Text style={styles.linkText}>{item.contactEmail}</Text>
                </Pressable>
              ) : null}
              {item.contactPhone ? (
                <Pressable
                  onPress={() =>
                    Linking.openURL(`tel:${(item.contactPhone ?? "").replace(/\s/g, "")}`)
                  }
                  style={styles.linkRow}
                >
                  <Ionicons name="call-outline" size={18} color={theme.colors.primary} />
                  <Text style={styles.linkText}>{item.contactPhone}</Text>
                </Pressable>
              ) : null}
              {item.notesToBusiness ? (
                <>
                  <Text style={styles.cardLabel}>Notes</Text>
                  <Text style={styles.notes}>{item.notesToBusiness}</Text>
                </>
              ) : null}
              {showShipCta(item) ? (
                <Pressable
                  style={styles.shipBtn}
                  onPress={() =>
                    router.push(`/seller-hub/orders/${item.storeOrderId}` as never)
                  }
                >
                  <Ionicons name="cube-outline" size={20} color="#fff" />
                  <Text style={styles.shipBtnText}>Purchase Shipping Label</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", paddingHorizontal: 16 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  backRow: { flexDirection: "row", alignItems: "center", marginTop: 48, marginBottom: 8, gap: 8 },
  backText: { fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", color: theme.colors.heading, marginBottom: 6 },
  subtitle: { fontSize: 14, color: "#666", marginBottom: 16 },
  manageBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  manageBtnText: {
    color: "#fff",
    fontWeight: "700",
  },
  bizPicker: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  bizPickerLabel: { fontSize: 16, fontWeight: "600", flex: 1, color: theme.colors.heading },
  errorBanner: {
    backgroundColor: "#fee",
    padding: 10,
    borderRadius: 8,
    marginBottom: 8,
  },
  errorText: { color: "#a00" },
  list: { paddingBottom: 40 },
  empty: { color: "#888", fontSize: 15, textAlign: "center", marginTop: 24 },
  card: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#fff",
  },
  cardTitle: { fontSize: 17, fontWeight: "700", color: theme.colors.heading },
  cardMeta: { fontSize: 13, color: "#666", marginBottom: 10 },
  cardLabel: { fontSize: 12, fontWeight: "700", color: "#888", marginTop: 6 },
  cardValue: { fontSize: 16, color: "#111" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  linkText: { fontSize: 15, color: theme.colors.primary, textDecorationLine: "underline" },
  notes: { fontSize: 14, color: "#333", marginTop: 4 },
  shipBtn: {
    marginTop: 12,
    backgroundColor: theme.colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
  },
  shipBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
