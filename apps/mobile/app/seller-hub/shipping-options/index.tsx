import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";
import { formatShippingOptionPackageSummary } from "@/lib/shipping-option-display";

type ShippingOption = {
  id: string;
  name: string;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  weightLbs: number;
  weightOzRemainder: number;
  shippingCostCents: number | null;
  source: "inw" | "ebay" | "etsy";
  complete: boolean;
};

type PageData = {
  options: ShippingOption[];
  importEbayShippingOptions: boolean;
  importEtsyShippingOptions: boolean;
  offerFreeShippingOnInw: boolean;
  ebayConnected: boolean;
  etsyConnected: boolean;
};

const emptyForm = {
  name: "",
  heightIn: "",
  widthIn: "",
  lengthIn: "",
  weightLbs: "",
  weightOz: "",
  shippingPrice: "",
};

function formatOptionPrice(cents: number | null | undefined): string {
  if (cents == null) return "No shipping price";
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

function dollarsToCents(raw: string): number {
  const trimmed = String(raw).trim();
  if (!trimmed) throw new Error("Shipping price is required");
  const n = Number(trimmed.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid shipping price");
  return Math.round(n * 100);
}

function carryOuncesIntoPoundsFields(
  weightLbs: string,
  weightOz: string
): { weightLbs: string; weightOz: string } {
  const lbs = Number(weightLbs.trim() === "" ? 0 : weightLbs);
  const oz = Number(weightOz);
  if (!Number.isFinite(lbs) || !Number.isFinite(oz) || oz < 16) {
    return { weightLbs, weightOz };
  }
  const total = Math.max(0, lbs) * 16 + Math.max(0, oz);
  const nextLbs = Math.floor(total / 16);
  const nextOz = Math.round((total - nextLbs * 16) * 1000) / 1000;
  return { weightLbs: String(nextLbs), weightOz: String(nextOz) };
}

function sourceLabel(source: string) {
  return source === "etsy" ? "Etsy" : source === "ebay" ? "eBay" : "INW";
}

export default function ShippingOptionsScreen() {
  const router = useRouter();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ShippingOption | null>(null);

  const load = useCallback(async () => {
    const json = await apiGet<PageData>("/api/shipping-options");
    setData(json);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load().catch((e: { error?: string }) => setError(e?.error || "Could not load shipping options"));
    }, [load])
  );

  async function patchPrefs(patch: Partial<PageData>) {
    setError(null);
    try {
      const json = await apiPatch<PageData>("/api/shipping-options", patch);
      setData(json);
    } catch (e: unknown) {
      setError((e as { error?: string })?.error || "Could not save");
    }
  }

  async function submitForm() {
    setSaving(true);
    setError(null);
    try {
      const weight = carryOuncesIntoPoundsFields(form.weightLbs, form.weightOz);
      const body = {
        name: form.name,
        heightIn: Number(form.heightIn),
        widthIn: Number(form.widthIn),
        lengthIn: Number(form.lengthIn),
        weightLbs: Number(weight.weightLbs || 0),
        weightOz: Number(weight.weightOz || 0),
        shippingCostCents: dollarsToCents(form.shippingPrice),
      };
      if (editing) {
        await apiPatch(`/api/shipping-options/${editing.id}`, body);
        setEditing(null);
      } else {
        await apiPost("/api/shipping-options", body);
      }
      setForm(emptyForm);
      await load();
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : (e as { error?: string })?.error || "Could not save option"
      );
    } finally {
      setSaving(false);
    }
  }

  function startEdit(opt: ShippingOption) {
    setEditing(opt);
    setCreateOpen(true);
    setForm({
      name: opt.name,
      heightIn: opt.heightIn != null ? String(opt.heightIn) : "",
      widthIn: opt.widthIn != null ? String(opt.widthIn) : "",
      lengthIn: opt.lengthIn != null ? String(opt.lengthIn) : "",
      weightLbs: String(opt.weightLbs || 0),
      weightOz: String(opt.weightOzRemainder || 0),
      shippingPrice: opt.shippingCostCents != null ? (opt.shippingCostCents / 100).toFixed(2) : "",
    });
  }

  function openMenu(opt: ShippingOption) {
    const marketplace = sourceLabel(opt.source);
    if (opt.source === "inw") {
      Alert.alert(opt.name, undefined, [
        { text: "Edit", onPress: () => startEdit(opt) },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void apiDelete(`/api/shipping-options/${opt.id}`)
              .then(load)
              .catch((e: { error?: string }) => setError(e?.error || "Could not remove option"));
          },
        },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    const url =
      opt.source === "etsy"
        ? "https://www.etsy.com/your/shops/me/tools/shipping"
        : "https://www.ebay.com/ship/bnd/seller-hub/shipping";
    Alert.alert(opt.name, `Synced options can only be edited on ${marketplace}.`, [
      { text: `Open ${marketplace}`, onPress: () => void Linking.openURL(url) },
      {
        text: "Hide on INW",
        onPress: () => {
          void apiDelete(`/api/shipping-options/${opt.id}`)
            .then(load)
            .catch((e: { error?: string }) => setError(e?.error || "Could not hide option"));
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Shipping Options</Text>
      <Text style={styles.hint}>
        Named packages (size, weight, and INW shipping price) used for checkout, labels, and listing sync.
      </Text>
      <Pressable onPress={() => router.push("/seller-hub/shipping-setup" as never)}>
        <Text style={styles.link}>Connect Shippo</Text>
      </Pressable>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <CheckboxRow
        label="Import shipping options from eBay"
        checked={Boolean(data?.importEbayShippingOptions)}
        disabled={!data?.ebayConnected}
        onToggle={(v) => void patchPrefs({ importEbayShippingOptions: v })}
      />
      <CheckboxRow
        label="Import shipping options from Etsy"
        checked={Boolean(data?.importEtsyShippingOptions)}
        disabled={!data?.etsyConnected}
        onToggle={(v) => void patchPrefs({ importEtsyShippingOptions: v })}
      />
      <CheckboxRow
        label="Offer free shipping on INW (Recommended)"
        checked={Boolean(data?.offerFreeShippingOnInw)}
        onToggle={(v) => void patchPrefs({ offerFreeShippingOnInw: v })}
      />

      <Pressable style={styles.createHeader} onPress={() => setCreateOpen((v) => !v)}>
        <Text style={styles.createTitle}>{editing ? "Edit Shipping Option" : "Create Shipping Option"}</Text>
        <Text style={styles.chevron}>{createOpen ? "▾" : "▸"}</Text>
      </Pressable>
      {createOpen && (
        <View style={styles.card}>
          <Text style={styles.label}>Name of option</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
            placeholder="e.g. Small box"
            placeholderTextColor={theme.colors.placeholder}
          />
          <Text style={styles.label}>Dimensions (in)</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={form.heightIn}
              onChangeText={(v) => setForm((f) => ({ ...f, heightIn: v }))}
              placeholder="Height"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, styles.flex]}
              value={form.widthIn}
              onChangeText={(v) => setForm((f) => ({ ...f, widthIn: v }))}
              placeholder="Width"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.input, styles.flex]}
              value={form.lengthIn}
              onChangeText={(v) => setForm((f) => ({ ...f, lengthIn: v }))}
              placeholder="Length"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="decimal-pad"
            />
          </View>
          <Text style={styles.label}>Weight</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={form.weightLbs}
              onChangeText={(v) => setForm((f) => ({ ...f, weightLbs: v }))}
              onBlur={() =>
                setForm((f) => ({ ...f, ...carryOuncesIntoPoundsFields(f.weightLbs, f.weightOz) }))
              }
              placeholder="lbs"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="number-pad"
            />
            <TextInput
              style={[styles.input, styles.flex]}
              value={form.weightOz}
              onChangeText={(v) => {
                setForm((f) => {
                  if (v.endsWith(".")) return { ...f, weightOz: v };
                  return { ...f, ...carryOuncesIntoPoundsFields(f.weightLbs, v) };
                });
              }}
              onBlur={() =>
                setForm((f) => ({ ...f, ...carryOuncesIntoPoundsFields(f.weightLbs, f.weightOz) }))
              }
              placeholder="oz"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="decimal-pad"
            />
          </View>
          <Text style={styles.hint}>16 ounces = 1 pound. Extra ounces are added to lbs automatically.</Text>
          <Text style={styles.label}>Shipping price (USD)</Text>
          <TextInput
            style={styles.input}
            value={form.shippingPrice}
            onChangeText={(v) => setForm((f) => ({ ...f, shippingPrice: v }))}
            placeholder="e.g. 5.99 — 0 for free"
            placeholderTextColor={theme.colors.placeholder}
            keyboardType="decimal-pad"
          />
          <Pressable
            style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
            onPress={() => void submitForm()}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>{editing ? "Save" : "Add Option"}</Text>
            )}
          </Pressable>
          {editing ? (
            <Pressable
              onPress={() => {
                setEditing(null);
                setForm(emptyForm);
              }}
            >
              <Text style={styles.link}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {(data?.options ?? []).map((opt, idx) => (
        <Pressable key={opt.id} style={styles.optionRow} onPress={() => openMenu(opt)}>
          <Text style={styles.optionIndex}>{idx + 1}.</Text>
          <View style={styles.optionBody}>
            <Text style={styles.optionName}>{opt.name}</Text>
            {(() => {
              const meta = [
                formatShippingOptionPackageSummary(opt),
                formatOptionPrice(opt.shippingCostCents),
              ]
                .filter(Boolean)
                .join(" · ");
              return meta ? <Text style={styles.optionMeta}>{meta}</Text> : null;
            })()}
          </View>
          {opt.source !== "inw" ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{sourceLabel(opt.source)}</Text>
            </View>
          ) : null}
          <Text style={styles.more}>⋯</Text>
        </Pressable>
      ))}
      {data && data.options.length === 0 ? (
        <Text style={styles.hint}>No shipping options yet. Create one above or import from eBay/Etsy.</Text>
      ) : null}
    </ScrollView>
  );
}

function CheckboxRow({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Pressable
      style={[styles.checkRow, disabled && { opacity: 0.45 }]}
      onPress={() => {
        if (!disabled) onToggle(!checked);
      }}
      disabled={disabled}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? <Text style={styles.checkMark}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 12 },
  link: { color: theme.colors.primary, fontSize: 14, fontWeight: "600", marginBottom: 16, textDecorationLine: "underline" },
  err: { color: "#c62828", marginBottom: 12, fontSize: 14 },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: "#ccc",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkMark: { color: "#fff", fontWeight: "700", fontSize: 14 },
  checkLabel: { flex: 1, fontSize: 15, color: "#000" },
  createHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, marginBottom: 8 },
  createTitle: { fontSize: 16, fontWeight: "700", color: theme.colors.heading },
  chevron: { fontSize: 16, color: "#666" },
  card: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  label: { fontSize: 13, fontWeight: "600", marginBottom: 6, color: "#333" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
    marginBottom: 10,
    color: "#000",
  },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 4,
    marginBottom: 8,
  },
  primaryBtnDisabled: { opacity: 0.65 },
  primaryBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  optionIndex: { color: "#888", width: 22 },
  optionBody: { flex: 1, minWidth: 0 },
  optionName: { fontSize: 15, fontWeight: "600", color: "#111" },
  optionMeta: { fontSize: 12, color: "#666", marginTop: 2 },
  pill: { borderWidth: 1, borderColor: "#ddd", borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 11, color: "#333" },
  more: { fontSize: 20, color: "#666", paddingHorizontal: 4 },
});
