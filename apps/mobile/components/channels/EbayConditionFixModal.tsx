import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

type EbayConditionChoice = {
  conditionId: number;
  enum: string;
  label: string;
  group: "new" | "used" | "other";
};

type ConditionContext = {
  storeItem: {
    id: string;
    title: string;
    photos: string[];
    condition: string;
    ebayCategoryId: number | null;
    ebayConditionEnum: string | null;
  };
  categoryId: string | null;
  presentation:
    | {
        mode: "binary";
        newOption: EbayConditionChoice;
        usedOption: EbayConditionChoice;
      }
    | {
        mode: "list";
        options: EbayConditionChoice[];
      };
};

type Props = {
  visible: boolean;
  storeItemId: string | null;
  onClose: () => void;
  onFixed: () => void;
};

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function photoUrl(path: string | undefined): string | null {
  if (!path?.trim()) return null;
  if (path.startsWith("http")) return path;
  return `${siteBase}${path.startsWith("/") ? path : `/${path}`}`;
}

export function EbayConditionFixModal({ visible, storeItemId, onClose, onFixed }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ctx, setCtx] = useState<ConditionContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!storeItemId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<ConditionContext>(
        `/api/channels/ebay/conditions?storeItemId=${encodeURIComponent(storeItemId)}`
      );
      setCtx(data);
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Could not load condition options.");
      setCtx(null);
    } finally {
      setLoading(false);
    }
  }, [storeItemId]);

  useEffect(() => {
    if (visible && storeItemId) {
      void load();
    } else if (!visible) {
      setCtx(null);
      setError(null);
    }
  }, [visible, storeItemId, load]);

  const submit = async (ebayConditionEnum: string) => {
    if (!storeItemId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiPost<{ ok?: boolean; error?: string }>("/api/channels/ebay/fix-condition", {
        storeItemId,
        ebayConditionEnum,
      });
      if (res.ok === false || (res as { error?: string }).error) {
        setError((res as { error?: string }).error ?? "Sync failed after updating condition.");
        return;
      }
      onFixed();
      onClose();
    } catch (e) {
      setError((e as { error?: string })?.error ?? "Could not update condition.");
    } finally {
      setSaving(false);
    }
  };

  const thumb = ctx?.storeItem.photos?.[0] ? photoUrl(ctx.storeItem.photos[0]) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Choose item condition</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color="#666" />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : (
            <>
              {ctx && (
                <View style={styles.listingRow}>
                  {thumb ? (
                    <Image source={{ uri: thumb }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbPlaceholder]}>
                      <Ionicons name="image-outline" size={22} color="#999" />
                    </View>
                  )}
                  <Text style={styles.listingTitle} numberOfLines={2}>
                    {ctx.storeItem.title}
                  </Text>
                </View>
              )}

              <Text style={styles.prompt}>
                eBay needs a condition that matches this listing&apos;s category. Is this item new or used?
              </Text>

              {ctx?.presentation.mode === "binary" && (
                <View style={styles.choiceRow}>
                  <Pressable
                    style={[styles.choiceBtn, saving && styles.choiceBtnDisabled]}
                    disabled={saving}
                    onPress={() => void submit(ctx.presentation.newOption.enum)}
                  >
                    <Ionicons name="sparkles-outline" size={22} color={theme.colors.primary} />
                    <Text style={styles.choiceLabel}>New</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.choiceBtn, saving && styles.choiceBtnDisabled]}
                    disabled={saving}
                    onPress={() => void submit(ctx.presentation.usedOption.enum)}
                  >
                    <Ionicons name="repeat-outline" size={22} color={theme.colors.primary} />
                    <Text style={styles.choiceLabel}>Used</Text>
                  </Pressable>
                </View>
              )}

              {ctx?.presentation.mode === "list" && (
                <View style={styles.listOptions}>
                  {ctx.presentation.options.map((opt) => (
                    <Pressable
                      key={opt.enum}
                      style={[styles.listBtn, saving && styles.choiceBtnDisabled]}
                      disabled={saving}
                      onPress={() => void submit(opt.enum)}
                    >
                      <Text style={styles.listBtnText}>{opt.label}</Text>
                    </Pressable>
                  ))}
                </View>
              )}

              {error && <Text style={styles.errorText}>{error}</Text>}

              {saving && (
                <View style={styles.savingRow}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={styles.savingText}>Updating eBay…</Text>
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    maxWidth: 420,
    width: "100%",
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: "700", color: "#111", flex: 1, paddingRight: 8 },
  center: { paddingVertical: 32, alignItems: "center" },
  listingRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: "#eee" },
  thumbPlaceholder: { alignItems: "center", justifyContent: "center" },
  listingTitle: { flex: 1, fontSize: 15, fontWeight: "600", color: "#222" },
  prompt: { fontSize: 14, color: "#555", lineHeight: 20, marginBottom: 16 },
  choiceRow: { flexDirection: "row", gap: 12 },
  choiceBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#f8fbff",
  },
  choiceBtnDisabled: { opacity: 0.6 },
  choiceLabel: { fontSize: 16, fontWeight: "600", color: theme.colors.primary },
  listOptions: { gap: 8 },
  listBtn: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#fafafa",
  },
  listBtnText: { fontSize: 15, color: "#222" },
  errorText: { marginTop: 12, fontSize: 13, color: "#dc2626" },
  savingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  savingText: { fontSize: 13, color: "#666" },
});
