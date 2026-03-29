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

type OfferedCoupon = {
  id: string;
  name: string;
  discount: string;
  code: string;
  maxMonthlyUses: number;
  business: { id: string; name: string };
};

function CouponEditor({
  coupon,
  onRemoved,
  onAfterSave,
}: {
  coupon: OfferedCoupon;
  onRemoved: (id: string) => void;
  onAfterSave: () => void;
}) {
  const [name, setName] = useState(coupon.name);
  const [discount, setDiscount] = useState(coupon.discount);
  const [code, setCode] = useState(coupon.code);
  const [maxMonthlyUses, setMaxMonthlyUses] = useState(String(coupon.maxMonthlyUses));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(coupon.name);
    setDiscount(coupon.discount);
    setCode(coupon.code);
    setMaxMonthlyUses(String(coupon.maxMonthlyUses));
  }, [coupon.id, coupon.name, coupon.discount, coupon.code, coupon.maxMonthlyUses]);

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await apiPatch(`/api/coupons/${coupon.id}`, body);
      onAfterSave();
    } catch (e) {
      Alert.alert("Could not save", (e as { error?: string }).error ?? "Try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert("Delete coupon", "Delete this coupon? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void apiDelete(`/api/coupons/${coupon.id}`)
            .then(() => onRemoved(coupon.id))
            .catch((e) =>
              Alert.alert("Error", (e as { error?: string }).error ?? "Could not delete.")
            );
        },
      },
    ]);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.bizName}>{coupon.business?.name ?? "—"}</Text>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        editable={!busy}
        onEndEditing={() => {
          const v = name.trim();
          if (v && v !== coupon.name) void patch({ name: v });
        }}
      />
      <Text style={styles.fieldLabel}>Discount</Text>
      <TextInput
        style={styles.input}
        value={discount}
        onChangeText={setDiscount}
        editable={!busy}
        onEndEditing={() => {
          const v = discount.trim();
          if (v && v !== coupon.discount) void patch({ discount: v });
        }}
      />
      <Text style={styles.fieldLabel}>Code</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={setCode}
        autoCapitalize="characters"
        editable={!busy}
        onEndEditing={() => {
          const v = code.trim();
          if (v && v !== coupon.code) void patch({ code: v });
        }}
      />
      <Text style={styles.fieldLabel}>Max monthly uses</Text>
      <TextInput
        style={styles.input}
        value={maxMonthlyUses}
        onChangeText={setMaxMonthlyUses}
        keyboardType="number-pad"
        editable={!busy}
        onEndEditing={() => {
          const n = parseInt(maxMonthlyUses, 10);
          if (!Number.isFinite(n) || n < 1) {
            setMaxMonthlyUses(String(coupon.maxMonthlyUses));
            return;
          }
          if (n !== coupon.maxMonthlyUses) void patch({ maxMonthlyUses: n });
        }}
      />
      <Pressable
        style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.85 }]}
        onPress={confirmDelete}
        disabled={busy}
      >
        <Text style={styles.deleteBtnText}>Delete coupon</Text>
      </Pressable>
    </View>
  );
}

export default function BusinessHubOfferedCouponsScreen() {
  const router = useRouter();
  const [coupons, setCoupons] = useState<OfferedCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<{ coupons: OfferedCoupon[] }>("/api/business-hub/offered-coupons");
      setCoupons(Array.isArray(res.coupons) ? res.coupons : []);
    } catch (e) {
      setCoupons([]);
      setError((e as { error?: string }).error ?? "Could not load coupons.");
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

      <Text style={styles.title}>My Businesses Coupons</Text>
      <Text style={styles.subtitle}>Edit or delete coupons you have offered.</Text>

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
          {coupons.length === 0 ? (
            <Text style={styles.empty}>No coupons yet. Create one from Business Hub.</Text>
          ) : (
            coupons.map((c) => (
              <CouponEditor
                key={c.id}
                coupon={c}
                onRemoved={(id) => setCoupons((prev) => prev.filter((x) => x.id !== id))}
                onAfterSave={() => void load()}
              />
            ))
          )}
        </ScrollView>
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
  deleteBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#c62828",
  },
  deleteBtnText: { color: "#c62828", fontWeight: "600" },
  empty: { fontSize: 15, color: "#888", textAlign: "center", marginTop: 24 },
  errorBanner: {
    backgroundColor: "#ffebee",
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorText: { color: "#c62828" },
});
