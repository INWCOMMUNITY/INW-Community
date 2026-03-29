import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import * as ImagePicker from "expo-image-picker";
import { theme } from "@/lib/theme";
import { apiDelete, apiGet, apiPatch, apiUploadFile, getToken } from "@/lib/api";
import { CouponExpiryDatePickerField } from "@/components/CouponExpiryDatePickerField";
import {
  CouponPublicPreviewModal,
  type CouponPublicPreviewPayload,
} from "@/components/CouponPublicPreviewModal";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function toFullUrl(url: string): string {
  return url.startsWith("http")
    ? url
    : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

function sameLocalCalendarDay(a: string | null | undefined, b: string | null | undefined): boolean {
  if ((a == null || a === "") && (b == null || b === "")) return true;
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function expiresSummaryFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Offer ends ${d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
}

type OfferedCoupon = {
  id: string;
  name: string;
  discount: string;
  code: string;
  maxMonthlyUses: number;
  expiresAt?: string | null;
  imageUrl?: string | null;
  secretKey?: string | null;
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
  const [secretKey, setSecretKey] = useState(coupon.secretKey ?? "");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState(() =>
    coupon.imageUrl ? toFullUrl(coupon.imageUrl) : ""
  );
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    setName(coupon.name);
    setDiscount(coupon.discount);
    setCode(coupon.code);
    setMaxMonthlyUses(String(coupon.maxMonthlyUses));
    setSecretKey(coupon.secretKey ?? "");
    setImageUrl(coupon.imageUrl ? toFullUrl(coupon.imageUrl) : "");
  }, [
    coupon.id,
    coupon.name,
    coupon.discount,
    coupon.code,
    coupon.maxMonthlyUses,
    coupon.secretKey,
    coupon.imageUrl,
  ]);

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

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to add images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploadingImage(true);
    try {
      const token = await getToken();
      if (!token) {
        Alert.alert("Sign in required", "Sign in to upload photos.");
        return;
      }
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: "photo.jpg",
      } as unknown as Blob);
      const { url } = await apiUploadFile("/api/upload", formData);
      const fullUrl = toFullUrl(url);
      setImageUrl(fullUrl);
      await patch({ imageUrl: fullUrl });
    } catch (e) {
      Alert.alert("Upload failed", (e as { error?: string }).error ?? "Try again.");
    } finally {
      setUploadingImage(false);
    }
  };

  const removeImage = () => {
    setImageUrl("");
    void patch({ imageUrl: null });
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
      <Text style={styles.fieldLabel}>Redemption code</Text>
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
      <CouponExpiryDatePickerField
        expiresAtIso={coupon.expiresAt ?? null}
        disabled={busy}
        onCommit={(iso) => {
          if (sameLocalCalendarDay(coupon.expiresAt ?? null, iso)) return;
          void patch({ expiresAt: iso });
        }}
      />
      <Text style={styles.fieldLabel}>Secret key</Text>
      <Text style={styles.fieldHint}>
        Customers enter this when redeeming so you can track uses and they earn points. Leave empty if you do not use redemption tracking.
      </Text>
      <TextInput
        style={styles.input}
        value={secretKey}
        onChangeText={setSecretKey}
        placeholder="e.g. PLUMBER2026"
        autoCapitalize="none"
        editable={!busy}
        onEndEditing={() => {
          const v = secretKey.trim();
          const cur = (coupon.secretKey ?? "").trim();
          if (v === cur) return;
          void patch({ secretKey: v || null });
        }}
      />
      <Text style={styles.fieldLabel}>Max uses per month</Text>
      <Text style={styles.fieldHint}>How many times one customer can redeem per calendar month.</Text>
      <TextInput
        style={styles.input}
        value={maxMonthlyUses}
        onChangeText={(t) => setMaxMonthlyUses(t.replace(/[^0-9]/g, ""))}
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
      <Text style={styles.fieldLabel}>Photo (optional)</Text>
      {imageUrl ? (
        <View style={styles.imageRow}>
          <Image source={{ uri: imageUrl }} style={styles.previewImage} resizeMode="cover" />
          <Pressable
            style={({ pressed }) => [styles.removeImageBtn, pressed && { opacity: 0.85 }]}
            onPress={removeImage}
            disabled={busy || uploadingImage}
          >
            <Text style={styles.removeImageText}>×</Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable
        style={({ pressed }) => [
          styles.uploadBtn,
          (busy || uploadingImage) && styles.uploadBtnDisabled,
          pressed && { opacity: 0.85 },
        ]}
        onPress={() => void pickImage()}
        disabled={busy || uploadingImage}
      >
        {uploadingImage ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.uploadBtnText}>{imageUrl ? "Change photo" : "Upload photo"}</Text>
        )}
      </Pressable>
      <Pressable
        style={({ pressed }) => [styles.previewBtn, pressed && { opacity: 0.85 }]}
        onPress={() => setPreviewOpen(true)}
        disabled={busy}
      >
        <Text style={styles.previewBtnText}>Preview coupon</Text>
      </Pressable>

      <CouponPublicPreviewModal
        visible={previewOpen}
        onClose={() => setPreviewOpen(false)}
        preview={
          previewOpen
            ? ({
                businessName: coupon.business?.name ?? "",
                name: name.trim(),
                discount: discount.trim(),
                code: code.trim(),
                imageUrl: imageUrl || null,
                expiresSummary: expiresSummaryFromIso(coupon.expiresAt ?? null),
              } satisfies CouponPublicPreviewPayload)
            : null
        }
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
            <>
              <View style={styles.disclosure}>
                <Text style={styles.disclosureText}>
                  Coupons are for physical in-person use; online storefront redemption is not enabled yet.
                </Text>
              </View>
              {coupons.map((c) => (
              <CouponEditor
                key={c.id}
                coupon={c}
                onRemoved={(id) => setCoupons((prev) => prev.filter((x) => x.id !== id))}
                onAfterSave={() => void load()}
              />
              ))}
            </>
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
  fieldHint: { fontSize: 12, color: "#888", marginBottom: 6, marginTop: -6 },
  previewBtn: {
    alignSelf: "flex-start",
    marginBottom: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  previewBtnText: { fontSize: 15, fontWeight: "600", color: theme.colors.primary },
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
  disclosure: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d4a84b",
    backgroundColor: "#fffbeb",
  },
  disclosureText: { fontSize: 13, color: "#92400e", lineHeight: 19 },
  imageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  previewImage: { width: 88, height: 88, borderRadius: 8, backgroundColor: "#eee" },
  removeImageBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  removeImageText: { color: "#fff", fontSize: 22, lineHeight: 24, fontWeight: "600" },
  uploadBtn: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
    minWidth: 140,
    alignItems: "center",
  },
  uploadBtnDisabled: { opacity: 0.5 },
  uploadBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
});
