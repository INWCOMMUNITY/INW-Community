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
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import * as LinkingExpo from "expo-linking";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch, apiDelete, API_BASE } from "@/lib/api";
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
  source: "inw" | "etsy" | "shopify";
  complete: boolean;
};

type PageData = {
  options: ShippingOption[];
  offerFreeShippingOnInw: boolean;
  combineShipping: boolean;
  combinedShippingMaxCents: number | null;
  freeShippingMinimumCents: number | null;
  etsyConnected: boolean;
  shopifyConnected: boolean;
};

function centsToDollarInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

function parseDollarInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("Enter a valid dollar amount");
  return Math.round(n * 100);
}

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
  return source === "etsy" ? "Etsy" : source === "shopify" ? "Shopify" : "INW";
}

function marketplaceShippingUrl(source: "etsy" | "shopify") {
  return source === "etsy"
    ? "https://www.etsy.com/your/shops/me/tools/shipping"
    : "https://admin.shopify.com/store";
}

function parseShippoReturnUrl(url: string): { connected: boolean; error: string | null } {
  try {
    const parsed = LinkingExpo.parse(url);
    const q = parsed.queryParams ?? {};
    const connectedRaw = q.connected;
    const errRaw = q.oauth_error;
    const connected =
      connectedRaw === "shippo" ||
      (Array.isArray(connectedRaw) && connectedRaw[0] === "shippo");
    const errVal = Array.isArray(errRaw) ? errRaw[0] : errRaw;
    const error =
      typeof errVal === "string" && errVal.length > 0
        ? decodeURIComponent(errVal.replace(/\+/g, " "))
        : null;
    return { connected, error };
  } catch {
    return { connected: false, error: null };
  }
}

export default function ShippingScreen() {
  const params = useLocalSearchParams<{ connected?: string; oauth_error?: string }>();
  const [oauthLoading, setOauthLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [shippoError, setShippoError] = useState<string | null>(null);
  const [shippoSuccess, setShippoSuccess] = useState(false);

  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState<"etsy" | "shopify" | null>(null);
  const [editing, setEditing] = useState<ShippingOption | null>(null);
  const [combineShipping, setCombineShipping] = useState(false);
  const [combineMaxInput, setCombineMaxInput] = useState("");
  const [freeOverInput, setFreeOverInput] = useState("");

  React.useEffect(() => {
    setCombineShipping(Boolean(data?.combineShipping));
    setCombineMaxInput(centsToDollarInput(data?.combinedShippingMaxCents));
    setFreeOverInput(centsToDollarInput(data?.freeShippingMinimumCents));
  }, [data?.combineShipping, data?.combinedShippingMaxCents, data?.freeShippingMinimumCents]);

  const refreshShippoStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const shipping = await apiGet<{ connected?: boolean }>("/api/shipping/status");
      setConnected(Boolean(shipping.connected));
    } catch {
      setConnected(false);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadOptions = useCallback(async () => {
    const json = await apiGet<PageData>("/api/shipping-options");
    setData(json);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshShippoStatus();
      loadOptions().catch((e: { error?: string }) =>
        setError(e?.error || "Could not load shipping options")
      );
    }, [refreshShippoStatus, loadOptions])
  );

  React.useEffect(() => {
    const c = params.connected;
    const e = params.oauth_error;
    if (c === "shippo") {
      setShippoSuccess(true);
      setShippoError(null);
      void refreshShippoStatus();
    }
    if (typeof e === "string" && e.length > 0) {
      setShippoError(decodeURIComponent(e.replace(/\+/g, " ")));
      setShippoSuccess(false);
    }
  }, [params.connected, params.oauth_error, refreshShippoStatus]);

  const openShippoOAuth = async () => {
    setOauthLoading(true);
    setShippoError(null);
    setShippoSuccess(false);
    try {
      const { url } = await apiPost<{ url: string }>("/api/shipping/oauth-link", {});
      if (!url) {
        setShippoError("Could not start Shippo connection.");
        return;
      }
      const returnUrl = `${API_BASE}/api/shipping/oauth-callback`;
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type === "success" && "url" in result && result.url) {
        const { connected: ok, error: err } = parseShippoReturnUrl(result.url);
        if (err) {
          setShippoError(err);
          setShippoSuccess(false);
        } else if (ok) {
          setShippoSuccess(true);
          setShippoError(null);
          await refreshShippoStatus();
        } else {
          await refreshShippoStatus();
        }
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setShippoError(err?.error ?? "Could not connect to Shippo. Try again.");
    } finally {
      setOauthLoading(false);
    }
  };

  async function patchPrefs(patch: Partial<PageData>) {
    setError(null);
    try {
      const json = await apiPatch<PageData>("/api/shipping-options", patch);
      setData(json);
    } catch (e: unknown) {
      setError((e as { error?: string })?.error || "Could not save");
    }
  }

  async function importFrom(provider: "etsy" | "shopify") {
    setError(null);
    setImporting(provider);
    try {
      const json = await apiPost<{
        options?: ShippingOption[];
        error?: string;
      }>("/api/shipping-options/import", { provider });
      if (Array.isArray(json.options)) {
        setData((prev) => (prev ? { ...prev, options: json.options as ShippingOption[] } : prev));
      } else {
        await loadOptions();
      }
    } catch (e: unknown) {
      setError(
        (e as { error?: string })?.error || `Could not import from ${sourceLabel(provider)}`
      );
    } finally {
      setImporting(null);
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
      await loadOptions();
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
    const buttons: {
      text: string;
      style?: "cancel" | "destructive";
      onPress?: () => void;
    }[] = [{ text: "Edit", onPress: () => startEdit(opt) }];
    if (opt.source === "etsy" || opt.source === "shopify") {
      buttons.push({
        text: `Open ${sourceLabel(opt.source)}`,
        onPress: () => void Linking.openURL(marketplaceShippingUrl(opt.source)),
      });
    }
    buttons.push(
      {
        text: opt.source === "inw" ? "Remove" : "Hide on INW",
        style: "destructive",
        onPress: () => {
          void apiDelete(`/api/shipping-options/${opt.id}`)
            .then(loadOptions)
            .catch((e: { error?: string }) => setError(e?.error || "Could not remove option"));
        },
      },
      { text: "Cancel", style: "cancel" }
    );
    Alert.alert(opt.name, undefined, buttons);
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Shipping</Text>
      <Text style={styles.hint}>
        Connect Shippo for labels, then manage named packages (size, weight, and INW shipping price) used for
        checkout, labels, and listing sync. After connecting, add at least one address in Shippo&apos;s Address
        Book (Settings → Addresses).
      </Text>

      {statusLoading ? (
        <ActivityIndicator style={styles.spinner} color={theme.colors.primary} />
      ) : connected ? (
        <View style={styles.bannerOk}>
          <Text style={styles.bannerOkText}>Shippo is connected.</Text>
          <Text style={styles.bannerHint}>Purchase labels from Seller Hub → Orders on the website.</Text>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [
          styles.primaryBtn,
          pressed && { opacity: 0.85 },
          oauthLoading && styles.primaryBtnDisabled,
        ]}
        onPress={() => void openShippoOAuth()}
        disabled={oauthLoading}
      >
        {oauthLoading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.primaryBtnText}>
            {connected ? "Reconnect Shippo" : "Connect with Shippo"}
          </Text>
        )}
      </Pressable>

      {shippoSuccess && !shippoError ? (
        <Text style={styles.success}>
          You&apos;re set. If you haven&apos;t already, add an address in Shippo&apos;s Address Book.
        </Text>
      ) : null}
      {shippoError ? <Text style={styles.err}>{shippoError}</Text> : null}

      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Shipping Rules</Text>
      <Text style={styles.hint}>
        Each shipped item’s shipping price is added together. Cap a combined order, or offer free shipping over a store total.
      </Text>
      <CheckboxRow
        label="Do you combine shipping?"
        checked={combineShipping}
        onToggle={(checked) => {
          setCombineShipping(checked);
          void patchPrefs({ combineShipping: checked });
        }}
      />
      {combineShipping ? (
        <View style={{ marginBottom: 12 }}>
          <Text style={styles.label}>Combined orders have a maximum shipping price of</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            placeholder="e.g. 8.00"
            value={combineMaxInput}
            onChangeText={setCombineMaxInput}
            onBlur={() => {
              try {
                const cents = parseDollarInput(combineMaxInput);
                setCombineMaxInput(centsToDollarInput(cents));
                void patchPrefs({ combinedShippingMaxCents: cents });
              } catch (err) {
                setError(err instanceof Error ? err.message : "Enter a valid dollar amount");
              }
            }}
          />
          <Text style={styles.hint}>
            When a buyer ships more than one item from your store, shipping will not exceed this amount. A single item still uses its own shipping price.
          </Text>
        </View>
      ) : null}
      <Text style={styles.label}>Offer free shipping on purchases over</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        placeholder="e.g. 50.00"
        value={freeOverInput}
        onChangeText={setFreeOverInput}
        onBlur={() => {
          try {
            const cents = parseDollarInput(freeOverInput);
            if (cents === 0) {
              setError("Enter an amount greater than 0, or leave this blank.");
              return;
            }
            setFreeOverInput(centsToDollarInput(cents));
            void patchPrefs({ freeShippingMinimumCents: cents });
          } catch (err) {
            setError(err instanceof Error ? err.message : "Enter a valid dollar amount");
          }
        }}
      />
      {(() => {
        const amount = freeOverInput.trim();
        const n = Number(amount.replace(/[^0-9.]/g, ""));
        if (!amount || !Number.isFinite(n) || n <= 0) return null;
        return (
          <Text style={styles.hint}>
            Buyers will be notified that if they order ${n.toFixed(2)} from your store, they will receive free shipping.
          </Text>
        );
      })()}

      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Shipping options</Text>
      <Text style={styles.hint}>
        Create packages for listings, or import from connected marketplaces.
      </Text>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <Pressable
        style={[styles.primaryBtn, (!data?.etsyConnected || importing != null) && styles.primaryBtnDisabled]}
        disabled={!data?.etsyConnected || importing != null}
        onPress={() => void importFrom("etsy")}
      >
        {importing === "etsy" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Import from Etsy</Text>
        )}
      </Pressable>
      <Pressable
        style={[
          styles.primaryBtn,
          styles.importBtnSpacing,
          (!data?.shopifyConnected || importing != null) && styles.primaryBtnDisabled,
        ]}
        disabled={!data?.shopifyConnected || importing != null}
        onPress={() => void importFrom("shopify")}
      >
        {importing === "shopify" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Import from Shopify</Text>
        )}
      </Pressable>
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
        <Text style={styles.hint}>No shipping options yet. Create one above or import from Etsy/Shopify.</Text>
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
  sectionTitle: { fontSize: 17, fontWeight: "700", marginBottom: 6, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 12 },
  link: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 16,
    textDecorationLine: "underline",
  },
  spinner: { marginVertical: 16 },
  bannerOk: {
    backgroundColor: "#e8f5e9",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  bannerOkText: { fontSize: 15, fontWeight: "600", color: "#2e7d32" },
  bannerHint: { fontSize: 13, color: "#666", marginTop: 6 },
  success: { color: "#2e7d32", marginTop: 12, marginBottom: 8, fontSize: 14 },
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
  createHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 8,
  },
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
  importBtnSpacing: { marginTop: 10 },
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
  pill: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: { fontSize: 11, color: "#333" },
  more: { fontSize: 20, color: "#666", paddingHorizontal: 4 },
});
