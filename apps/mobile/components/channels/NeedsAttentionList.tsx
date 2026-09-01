import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Switch,
  Image,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme, switchIosBackgroundColor, switchThumbColor, switchTrackColor } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { SelectField } from "@/components/listing/SelectField";
import { EbayConditionFixModal } from "@/components/channels/EbayConditionFixModal";
import { ListOnChannelCategoryModal } from "@/components/channels/ListOnChannelCategoryModal";
import {
  isEbaySpecificsAttentionItem,
  listOnStepFromEbayAttentionItem,
  type ListOnCategoryAssignment,
  type ListOnCategoryStep,
} from "@/lib/list-on-channel-category";

export type NeedsAttentionField = {
  key: string;
  label: string;
  type: "select" | "boolean" | "zip" | "category" | "text";
  value: string | boolean | number | null;
  helpText?: string;
  options?: { value: string; label: string }[];
};

export type NeedsAttentionItem = {
  id: string;
  kind: "listing" | "shop";
  storeItemId: string | null;
  connectionId: string;
  title: string;
  photo: string | null;
  photos?: string[];
  ebayCategoryId?: number | null;
  aspects?: unknown;
  provider: string;
  summary: string;
  syncError: string | null;
  fields: NeedsAttentionField[];
  action: "fill" | "ebay_condition" | "retry_only";
  canRetry: boolean;
};

function ebaySpecificsSummary(item: NeedsAttentionItem): string {
  const names = item.fields.filter((field) => field.key.startsWith("aspect:")).map((field) => field.label);
  if (names.length > 0) {
    return `eBay needs ${names.join(", ")} for this listing. Pick the values eBay lists.`;
  }
  return "eBay needs item specifics for this listing. Pick the values eBay lists.";
}

function attentionToEbayStep(item: NeedsAttentionItem): ListOnCategoryStep | null {
  if (!item.storeItemId) return null;
  return listOnStepFromEbayAttentionItem({
    storeItemId: item.storeItemId,
    title: item.title,
    photo: item.photo,
    photos: item.photos,
    ebayCategoryId: item.ebayCategoryId,
    aspects: item.aspects,
    fields: item.fields,
  });
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function photoUri(path: string | null): string | null {
  if (!path?.trim()) return null;
  if (path.startsWith("http")) return path;
  return `${siteBase}${path.startsWith("/") ? path : `/${path}`}`;
}

const PROVIDER_NAMES: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  shopify: "Shopify",
  wix: "Wix",
};

function CardForm({
  item,
  onSaved,
  onOpenEbaySpecifics,
  onDismiss,
}: {
  item: NeedsAttentionItem;
  onSaved: (items: NeedsAttentionItem[]) => void;
  onOpenEbaySpecifics?: (item: NeedsAttentionItem) => void;
  onDismiss: (item: NeedsAttentionItem) => void;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean | number | null>>(() => {
    const next: Record<string, string | boolean | number | null> = {};
    for (const f of item.fields) next[f.key] = f.value;
    return next;
  });
  const [catQuery, setCatQuery] = useState("");
  const [catResults, setCatResults] = useState<{ taxonomyId: number; categoryName: string; categoryPath?: string }[]>(
    []
  );
  const [catLabel, setCatLabel] = useState("");
  const [conditionItemId, setConditionItemId] = useState<string | null>(null);

  useEffect(() => {
    const q = catQuery.trim();
    if (q.length < 2) {
      setCatResults([]);
      return;
    }
    const t = setTimeout(() => {
      void apiGet<{ categories?: { taxonomyId: number; categoryName: string; categoryPath?: string }[] }>(
        `/api/channels/etsy/categories?q=${encodeURIComponent(q)}`
      )
        .then((res) => setCatResults(res.categories ?? []))
        .catch(() => setCatResults([]));
    }, 280);
    return () => clearTimeout(t);
  }, [catQuery]);

  const save = async () => {
    setSaving(true);
    try {
      const fields: Record<string, unknown> = {};
      if (typeof values.etsyWhoMade === "string") fields.etsyWhoMade = values.etsyWhoMade;
      if (typeof values.etsyWhenMade === "string") fields.etsyWhenMade = values.etsyWhenMade;
      if (typeof values.etsyIsSupply === "boolean") fields.etsyIsSupply = values.etsyIsSupply;
      if (typeof values.etsyTaxonomyId === "number") fields.etsyTaxonomyId = values.etsyTaxonomyId;
      if (typeof values.etsyOriginPostalCode === "string") {
        fields.etsyOriginPostalCode = values.etsyOriginPostalCode;
      }
      const aspects: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        if (key.startsWith("aspect:") && typeof value === "string" && value.trim()) {
          aspects[key.slice("aspect:".length)] = value.trim();
        }
      }
      if (Object.keys(aspects).length > 0) fields.aspects = aspects;
      const res = await apiPost<{
        ok: boolean;
        items: NeedsAttentionItem[];
        retryResult?: { ok: boolean; error?: string };
        retryResults?: { ok: boolean; error?: string }[];
        error?: string;
      }>("/api/seller/needs-attention", {
        id: item.id,
        kind: item.kind,
        fields,
        retry: true,
      });
      onSaved(res.items ?? []);
      const firstError =
        res.retryResult?.error ?? res.retryResults?.find((r) => r.error)?.error;
      if (firstError) {
        Alert.alert("Saved, but sync is still blocked", firstError);
      }
    } catch (e) {
      const msg = (e as { error?: string })?.error ?? "Could not save. Try again.";
      Alert.alert("Could not save", msg);
    } finally {
      setSaving(false);
    }
  };

  const retryOnly = async () => {
    setSaving(true);
    try {
      const res = await apiPost<{ items: NeedsAttentionItem[]; retryResult?: { ok: boolean; error?: string } }>(
        "/api/seller/needs-attention",
        { id: item.id, kind: item.kind, retry: true }
      );
      onSaved(res.items ?? []);
      if (res.retryResult?.error) Alert.alert("Still blocked", res.retryResult.error);
    } catch (e) {
      Alert.alert("Retry failed", (e as { error?: string })?.error ?? "Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        {photoUri(item.photo) ? (
          <Image source={{ uri: photoUri(item.photo)! }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]}>
            <Ionicons name="image-outline" size={18} color="#999" />
          </View>
        )}
        <View style={styles.cardHeaderText}>
          <Text style={styles.provider}>{PROVIDER_NAMES[item.provider] ?? item.provider}</Text>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
        </View>
        <Pressable
          onPress={() => onDismiss(item)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss this request"
          style={styles.dismissBtn}
        >
          <Ionicons name="close" size={20} color="#666" />
        </Pressable>
      </View>
      <Text style={styles.summary}>
        {isEbaySpecificsAttentionItem(item) ? ebaySpecificsSummary(item) : item.summary}
      </Text>

      {!isEbaySpecificsAttentionItem(item) &&
        item.fields.map((field) => {
        if (field.type === "select" && field.options) {
          return (
            <SelectField
              key={field.key}
              label={field.label}
              value={String(values[field.key] ?? "")}
              options={field.options}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
            />
          );
        }
        if (field.type === "boolean") {
          const on = values[field.key] === true;
          return (
            <View key={field.key} style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>{field.label}</Text>
                {field.helpText ? <Text style={styles.help}>{field.helpText}</Text> : null}
              </View>
              <Switch
                value={on}
                onValueChange={(v) => setValues((prev) => ({ ...prev, [field.key]: v }))}
                trackColor={switchTrackColor()}
                thumbColor={switchThumbColor(on)}
                ios_backgroundColor={switchIosBackgroundColor}
              />
            </View>
          );
        }
        if (field.type === "text") {
          return (
            <View key={field.key} style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <TextInput
                value={String(values[field.key] ?? "")}
                onChangeText={(t) => setValues((prev) => ({ ...prev, [field.key]: t }))}
                placeholder={field.label}
                placeholderTextColor="#999"
                style={styles.input}
              />
              {field.helpText ? <Text style={styles.help}>{field.helpText}</Text> : null}
            </View>
          );
        }
        if (field.type === "zip") {
          return (
            <View key={field.key} style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              <TextInput
                value={String(values[field.key] ?? "")}
                onChangeText={(t) =>
                  setValues((prev) => ({ ...prev, [field.key]: t.replace(/\D/g, "").slice(0, 5) }))
                }
                placeholder="99201"
                placeholderTextColor="#999"
                keyboardType="number-pad"
                style={styles.input}
              />
              {field.helpText ? <Text style={styles.help}>{field.helpText}</Text> : null}
            </View>
          );
        }
        if (field.type === "category") {
          return (
            <View key={field.key} style={styles.fieldWrap}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              {typeof values.etsyTaxonomyId === "number" && catLabel ? (
                <Text style={styles.selectedCat}>{catLabel}</Text>
              ) : null}
              <TextInput
                value={catQuery}
                onChangeText={setCatQuery}
                placeholder="Search Etsy categories"
                placeholderTextColor="#999"
                style={styles.input}
              />
              {catResults.map((c) => (
                <Pressable
                  key={c.taxonomyId}
                  style={styles.catRow}
                  onPress={() => {
                    setValues((prev) => ({ ...prev, etsyTaxonomyId: c.taxonomyId }));
                    setCatLabel(c.categoryPath || c.categoryName);
                    setCatQuery("");
                    setCatResults([]);
                  }}
                >
                  <Text style={styles.catRowText}>{c.categoryPath || c.categoryName}</Text>
                </Pressable>
              ))}
              {field.helpText ? <Text style={styles.help}>{field.helpText}</Text> : null}
            </View>
          );
        }
        return null;
      })}

      <View style={styles.actions}>
        {isEbaySpecificsAttentionItem(item) && onOpenEbaySpecifics ? (
          <Pressable style={styles.primaryBtn} onPress={() => onOpenEbaySpecifics(item)}>
            <Text style={styles.primaryBtnText}>Choose eBay values</Text>
          </Pressable>
        ) : item.action === "ebay_condition" && item.storeItemId ? (
          <Pressable
            style={styles.primaryBtn}
            onPress={() => setConditionItemId(item.storeItemId)}
          >
            <Text style={styles.primaryBtnText}>Choose New or Used</Text>
          </Pressable>
        ) : item.action === "retry_only" ? (
          <Pressable style={styles.primaryBtn} onPress={() => void retryOnly()} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Retry sync</Text>
            )}
          </Pressable>
        ) : (
          <Pressable style={styles.primaryBtn} onPress={() => void save()} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>Save and retry</Text>
            )}
          </Pressable>
        )}
        {item.storeItemId ? (
          <Pressable
            style={styles.secondaryBtn}
            onPress={() => router.push(`/seller-hub/store/new?edit=${item.storeItemId}` as never)}
          >
            <Text style={styles.secondaryBtnText}>Open listing</Text>
          </Pressable>
        ) : null}
      </View>
      <EbayConditionFixModal
        visible={!!conditionItemId}
        storeItemId={conditionItemId}
        onClose={() => setConditionItemId(null)}
        onFixed={() => {
          setConditionItemId(null);
          void apiGet<{ items: NeedsAttentionItem[] }>("/api/seller/needs-attention").then((r) =>
            onSaved(r.items ?? [])
          );
        }}
      />
    </View>
  );
}

export function NeedsAttentionList({
  refreshNonce,
  onCountChange,
}: {
  refreshNonce?: number;
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<NeedsAttentionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ebaySteps, setEbaySteps] = useState<ListOnCategoryStep[]>([]);
  const dismissedEbayKey = useRef<string | null>(null);

  function ebayQueueKey(list: NeedsAttentionItem[]) {
    return list
      .filter(isEbaySpecificsAttentionItem)
      .map((item) => item.id)
      .join(",");
  }

  function openEbayPopup(list: NeedsAttentionItem[]) {
    const steps = list
      .filter(isEbaySpecificsAttentionItem)
      .map(attentionToEbayStep)
      .filter((step): step is ListOnCategoryStep => step != null);
    if (steps.length === 0) return;
    setEbaySteps(steps);
  }

  async function saveEbayAssignments(assignments: ListOnCategoryAssignment[]) {
    let nextItems = items;
    for (const assignment of assignments) {
      const item = nextItems.find((row) => row.storeItemId === assignment.storeItemId);
      if (!item) continue;
      const aspects: Record<string, string> = {};
      for (const row of assignment.aspects ?? []) {
        if (row.name.trim() && row.value.trim()) aspects[row.name.trim()] = row.value.trim();
      }
      const res = await apiPost<{
        ok: boolean;
        items: NeedsAttentionItem[];
        retryResult?: { ok: boolean; error?: string };
        error?: string;
      }>("/api/seller/needs-attention", {
        id: item.id,
        kind: item.kind,
        fields: {
          ...(assignment.ebayCategoryId ? { ebayCategoryId: assignment.ebayCategoryId } : {}),
          ...(Object.keys(aspects).length > 0 ? { aspects } : {}),
        },
        retry: true,
      });
      nextItems = res.items ?? nextItems;
      if (res.retryResult?.error) throw new Error(res.retryResult.error);
    }
    setItems(nextItems);
    onCountChange?.(nextItems.length);
    dismissedEbayKey.current = ebayQueueKey(nextItems);
    setEbaySteps([]);
  }

  async function dismissItem(item: NeedsAttentionItem) {
    const previous = items;
    const next = items.filter((row) => row.id !== item.id);
    setItems(next);
    onCountChange?.(next.length);
    if (item.storeItemId && ebaySteps.some((step) => step.item.id === item.storeItemId)) {
      dismissedEbayKey.current = ebayQueueKey(next);
      setEbaySteps([]);
    }
    try {
      const res = await apiPost<{ items?: NeedsAttentionItem[] }>("/api/seller/needs-attention", {
        id: item.id,
        kind: item.kind,
        dismiss: true,
      });
      if (Array.isArray(res.items)) {
        setItems(res.items);
        onCountChange?.(res.items.length);
        dismissedEbayKey.current = ebayQueueKey(res.items);
      }
    } catch {
      setItems(previous);
      onCountChange?.(previous.length);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: NeedsAttentionItem[] }>("/api/seller/needs-attention");
      const next = res.items ?? [];
      setItems(next);
      onCountChange?.(next.length);
    } catch {
      setItems([]);
      onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void load();
  }, [load, refreshNonce]);

  useEffect(() => {
    if (loading) return;
    const key = ebayQueueKey(items);
    if (!key || dismissedEbayKey.current === key) return;
    openEbayPopup(items);
  }, [items, loading]);

  const count = items.length;
  const body = useMemo(() => {
    if (loading) {
      return <ActivityIndicator style={{ marginTop: 24 }} color={theme.colors.primary} />;
    }
    if (count === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="checkmark-circle" size={36} color="#16a34a" />
          <Text style={styles.emptyTitle}>Nothing needs attention</Text>
          <Text style={styles.emptyText}>
            When Etsy or eBay asks for origin, category, or ship-from ZIP, those listings show up here.
          </Text>
        </View>
      );
    }
    return items.map((item) => (
      <CardForm
        key={item.id}
        item={item}
        onSaved={(next) => {
          setItems(next);
          onCountChange?.(next.length);
        }}
        onOpenEbaySpecifics={(target) => {
          const step = attentionToEbayStep(target);
          if (step) setEbaySteps([step]);
        }}
        onDismiss={(target) => {
          void dismissItem(target);
        }}
      />
    ));
  }, [count, items, loading, onCountChange]);

  return (
    <View>
      {body}
      <ListOnChannelCategoryModal
        visible={ebaySteps.length > 0}
        steps={ebaySteps}
        heading="eBay listing details"
        completeLabel="Save"
        onClose={() => {
          dismissedEbayKey.current = ebayQueueKey(items);
          setEbaySteps([]);
        }}
        onComplete={saveEbayAssignments}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#f3d9a8",
  },
  cardHeader: { flexDirection: "row", gap: 10, marginBottom: 8, alignItems: "flex-start" },
  dismissBtn: { padding: 4, marginTop: -2 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: "#eee" },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  cardHeaderText: { flex: 1, minWidth: 0 },
  provider: { fontSize: 12, fontWeight: "700", color: theme.colors.primary, marginBottom: 2 },
  title: { fontSize: 15, fontWeight: "600", color: "#111" },
  summary: { fontSize: 13, color: "#444", marginBottom: 12, lineHeight: 18 },
  fieldWrap: { marginBottom: 10 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#333", marginBottom: 6 },
  help: { fontSize: 12, color: "#666", marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: "#111",
    backgroundColor: "#fff",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  selectedCat: { fontSize: 13, color: theme.colors.primary, marginBottom: 6 },
  catRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#eee" },
  catRowText: { fontSize: 14, color: "#222" },
  actions: { gap: 8, marginTop: 8 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryBtn: { paddingVertical: 8, alignItems: "center" },
  secondaryBtnText: { color: theme.colors.primary, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: 32, paddingHorizontal: 16 },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 8, color: "#111" },
  emptyText: { fontSize: 13, color: "#666", textAlign: "center", marginTop: 6, lineHeight: 18 },
});
