import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiDelete, apiGet, apiPatch } from "@/lib/api";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";

type OfferedReward = {
  id: string;
  title: string;
  pointsRequired: number;
  redemptionLimit: number;
  cashValueCents?: number | null;
  status: string;
  business: { id: string; name: string };
};

function RewardEditor({
  reward,
  onRemoved,
  onAfterSave,
  onEarnedBadges,
}: {
  reward: OfferedReward;
  onRemoved: (id: string) => void;
  onAfterSave: () => void;
  onEarnedBadges?: (badges: { slug: string; name: string; description?: string }[]) => void;
}) {
  const [title, setTitle] = useState(reward.title);
  const [points, setPoints] = useState(String(reward.pointsRequired));
  const [limit, setLimit] = useState(String(reward.redemptionLimit));
  const [cashDollars, setCashDollars] = useState(
    reward.cashValueCents != null && reward.cashValueCents > 0
      ? String(reward.cashValueCents / 100)
      : ""
  );
  const [status, setStatus] = useState(reward.status);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTitle(reward.title);
    setPoints(String(reward.pointsRequired));
    setLimit(String(reward.redemptionLimit));
    setCashDollars(
      reward.cashValueCents != null && reward.cashValueCents > 0
        ? String(reward.cashValueCents / 100)
        : ""
    );
    setStatus(reward.status);
  }, [reward.id, reward.title, reward.pointsRequired, reward.redemptionLimit, reward.cashValueCents, reward.status]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const data = await apiPatch<{
        earnedBadges?: { slug: string; name: string; description?: string }[];
      }>(`/api/rewards/${reward.id}`, body);
      const badges = (data?.earnedBadges ?? []).filter(
        (b): b is { slug: string; name: string; description?: string } =>
          Boolean(b?.slug && b?.name)
      );
      if (badges.length > 0) {
        onEarnedBadges?.(badges);
      }
      onAfterSave();
    } catch (e) {
      Alert.alert("Could not save", (e as { error?: string }).error ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirmRemove = () => {
    Alert.alert(
      "Remove reward",
      "This reward will be set to inactive and will no longer appear in the rewards list.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void apiDelete(`/api/rewards/${reward.id}`)
              .then(() => onRemoved(reward.id))
              .catch((e) =>
                Alert.alert("Error", (e as { error?: string }).error ?? "Could not remove.")
              );
          },
        },
      ]
    );
  };

  const redeemedOut = status === "redeemed_out";

  return (
    <View style={styles.card}>
      <Text style={styles.bizName}>{reward.business?.name ?? "—"}</Text>
      <Text style={styles.fieldLabel}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        editable={!busy && !redeemedOut}
        onEndEditing={() => {
          const v = title.trim();
          if (v && v !== reward.title) void patch({ title: v });
        }}
      />
      <Text style={styles.fieldLabel}>Points required</Text>
      <TextInput
        style={styles.input}
        value={points}
        onChangeText={setPoints}
        keyboardType="number-pad"
        editable={!busy && !redeemedOut}
        onEndEditing={() => {
          const n = parseInt(points, 10);
          if (!Number.isFinite(n) || n < 1) {
            setPoints(String(reward.pointsRequired));
            return;
          }
          if (n !== reward.pointsRequired) void patch({ pointsRequired: n });
        }}
      />
      <Text style={styles.fieldLabel}>Redemption limit</Text>
      <TextInput
        style={styles.input}
        value={limit}
        onChangeText={setLimit}
        keyboardType="number-pad"
        editable={!busy && !redeemedOut}
        onEndEditing={() => {
          const n = parseInt(limit, 10);
          if (!Number.isFinite(n) || n < 1) {
            setLimit(String(reward.redemptionLimit));
            return;
          }
          if (n !== reward.redemptionLimit) void patch({ redemptionLimit: n });
        }}
      />
      <Text style={styles.fieldLabel}>Cash value per redemption ($)</Text>
      <TextInput
        style={styles.input}
        value={cashDollars}
        onChangeText={setCashDollars}
        keyboardType="decimal-pad"
        editable={!busy && !redeemedOut}
        placeholder="e.g. 25"
        placeholderTextColor="#999"
        onEndEditing={() => {
          const raw = cashDollars.trim();
          if (raw === "") {
            if (reward.cashValueCents != null) void patch({ cashValueCents: null });
            return;
          }
          const n = Number(raw);
          if (!Number.isFinite(n) || n < 0) {
            setCashDollars(
              reward.cashValueCents != null && reward.cashValueCents > 0
                ? String(reward.cashValueCents / 100)
                : ""
            );
            return;
          }
          const cents = Math.min(Math.round(n * 100), 2_147_483_647);
          if (cents !== (reward.cashValueCents ?? -1)) void patch({ cashValueCents: cents });
        }}
      />

      {redeemedOut ? (
        <Text style={styles.lockedNote}>Status: redeemed out (set automatically)</Text>
      ) : (
        <>
          <Text style={styles.fieldLabel}>Status</Text>
          <View style={styles.statusRow}>
            {(["active", "inactive"] as const).map((s) => (
              <Pressable
                key={s}
                style={({ pressed }) => [
                  styles.statusChip,
                  status === s && styles.statusChipOn,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => {
                  if (s !== status) {
                    setStatus(s);
                    void patch({ status: s });
                  }
                }}
                disabled={busy}
              >
                <Text style={[styles.statusChipText, status === s && styles.statusChipTextOn]}>
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      )}

      {!redeemedOut ? (
        <Pressable
          style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.85 }]}
          onPress={confirmRemove}
          disabled={busy}
        >
          <Text style={styles.removeBtnText}>Remove reward</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function BusinessHubOfferedRewardsScreen() {
  const router = useRouter();
  const [rewards, setRewards] = useState<OfferedReward[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earnedBadges, setEarnedBadges] = useState<
    { slug: string; name: string; description?: string }[]
  >([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<{ rewards: OfferedReward[] }>("/api/business-hub/offered-rewards");
      setRewards(Array.isArray(res.rewards) ? res.rewards : []);
    } catch (e) {
      setRewards([]);
      setError((e as { error?: string }).error ?? "Could not load rewards.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  return (
    <View style={styles.container}>
      <Pressable style={styles.backRow} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Text style={styles.title}>My Businesses Rewards</Text>
      <Text style={styles.subtitle}>
        Edit or remove rewards. Removing sets a reward to inactive.
      </Text>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {rewards.length === 0 ? (
            <Text style={styles.empty}>No rewards yet. Offer one from Business Hub.</Text>
          ) : (
            rewards.map((r) => (
              <RewardEditor
                key={r.id}
                reward={r}
                onRemoved={(id) => setRewards((prev) => prev.filter((x) => x.id !== id))}
                onAfterSave={() => void load()}
                onEarnedBadges={(badges) => {
                  setEarnedBadges(badges);
                  setBadgePopupIndex(0);
                }}
              />
            ))
          )}
        </ScrollView>
      )}

      {badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length && (
        <BadgeEarnedPopup
          visible
          onClose={() => {
            const next = badgePopupIndex + 1;
            if (next < earnedBadges.length) {
              setBadgePopupIndex(next);
            } else {
              setEarnedBadges([]);
              setBadgePopupIndex(-1);
            }
          }}
          badgeName={earnedBadges[badgePopupIndex].name}
          badgeSlug={earnedBadges[badgePopupIndex].slug}
          badgeDescription={earnedBadges[badgePopupIndex].description}
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
  scroll: { paddingBottom: 40 },
  card: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
  },
  bizName: { fontSize: 15, fontWeight: "700", color: theme.colors.heading, marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#666", marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
    color: theme.colors.heading,
  },
  statusRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statusChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#fafafa",
  },
  statusChipOn: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.cream,
  },
  statusChipText: { fontSize: 14, color: "#555", textTransform: "capitalize" },
  statusChipTextOn: { color: theme.colors.primary, fontWeight: "700" },
  lockedNote: { fontSize: 14, color: "#666", marginBottom: 8, fontStyle: "italic" },
  removeBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c62828",
  },
  removeBtnText: { color: "#c62828", fontWeight: "600" },
  empty: { fontSize: 15, color: "#888", textAlign: "center", marginTop: 24 },
  errorBanner: {
    backgroundColor: "#ffebee",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: { color: "#c62828" },
});
