import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
} from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

type RemoteListing = {
  externalListingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  photos: string[];
  alreadyLinked?: boolean;
};

const PROVIDER_LABELS: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  wix: "Wix",
  shopify: "Shopify",
};

export default function ChannelImportScreen() {
  const params = useLocalSearchParams<{ provider?: string }>();
  const provider = (Array.isArray(params.provider) ? params.provider[0] : params.provider) || "etsy";
  const label = PROVIDER_LABELS[provider] ?? provider;

  const [listings, setListings] = useState<RemoteListing[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const importPath = useMemo(() => `/api/channels/${provider}/import`, [provider]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ listings: RemoteListing[]; error?: string }>(importPath);
      setListings(Array.isArray(data.listings) ? data.listings : []);
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? `Could not load your ${label} listings.`);
    } finally {
      setLoading(false);
    }
  }, [importPath, label]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiPost<{
        imported: unknown[];
        skipped?: {
          externalListingId: string;
          title?: string;
          step?: string;
          reason: string;
          hint?: string;
        }[];
        summary?: string;
        hint?: string;
      }>(importPath, {
        listingIds: Array.from(selected),
      });
      const importedCount = res.imported?.length ?? 0;
      const skipped = res.skipped ?? [];
      const summary =
        res.summary ??
        (importedCount > 0
          ? `Imported ${importedCount} listing${importedCount === 1 ? "" : "s"}.`
          : "No listings were imported.");
      setDone(summary);
      if (importedCount === 0 && (res.hint || skipped.length > 0)) {
        setError(res.hint ?? summary);
      }
      setSelected(new Set());
      await load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Import failed. Try again.");
    } finally {
      setImporting(false);
    }
  };

  const importable = listings.filter((l) => !l.alreadyLinked);

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Import from {label}</Text>
        <Text style={styles.hint}>
          Select the {label} listings to bring into your INW store. Imported items stay in sync: a
          sale on either store updates inventory on both.
        </Text>

        {loading ? (
          <ActivityIndicator style={styles.spinner} color={theme.colors.primary} />
        ) : listings.length === 0 ? (
          <Text style={styles.empty}>No {label} listings found.</Text>
        ) : (
          listings.map((l) => {
            const isSelected = selected.has(l.externalListingId);
            return (
              <Pressable
                key={l.externalListingId}
                style={[styles.row, l.alreadyLinked && styles.rowDisabled]}
                onPress={() => !l.alreadyLinked && toggle(l.externalListingId)}
                disabled={l.alreadyLinked}
              >
                {l.photos[0] ? (
                  <Image source={{ uri: l.photos[0] }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbEmpty]} />
                )}
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle} numberOfLines={2}>
                    {l.title}
                  </Text>
                  <Text style={styles.rowMeta}>
                    ${(l.priceCents / 100).toFixed(2)} · Qty {l.quantity}
                  </Text>
                  {l.alreadyLinked && <Text style={styles.linkedTag}>Already imported</Text>}
                </View>
                {!l.alreadyLinked && (
                  <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                )}
              </Pressable>
            );
          })
        )}

        {done && !error && <Text style={styles.success}>{done}</Text>}
        {error ? <Text style={styles.err}>{error}</Text> : null}
      </ScrollView>

      {importable.length > 0 && (
        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { opacity: 0.85 },
              (importing || selected.size === 0) && styles.primaryBtnDisabled,
            ]}
            onPress={runImport}
            disabled={importing || selected.size === 0}
          >
            {importing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryBtnText}>
                Import {selected.size > 0 ? `${selected.size} ` : ""}selected
              </Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 20 },
  spinner: { marginVertical: 16 },
  empty: { fontSize: 14, color: "#666", marginTop: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  rowDisabled: { opacity: 0.5 },
  thumb: { width: 56, height: 56, borderRadius: 6, backgroundColor: "#f0f0f0" },
  thumbEmpty: { borderWidth: 1, borderColor: "#e0e0e0" },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: "#000" },
  rowMeta: { fontSize: 13, color: "#666", marginTop: 4 },
  linkedTag: { fontSize: 12, color: "#2e7d32", marginTop: 4 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: { backgroundColor: theme.colors.primary },
  checkmark: { color: "#fff", fontWeight: "700", fontSize: 14 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e0e0e0" },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  success: { color: "#2e7d32", marginTop: 16, fontSize: 14 },
  err: { color: "#c62828", marginTop: 16, fontSize: 14 },
});
