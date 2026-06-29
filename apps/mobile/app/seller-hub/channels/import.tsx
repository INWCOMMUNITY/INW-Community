import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Image,
  Modal,
} from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

type RemoteListing = {
  externalListingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  photos: string[];
  alreadyLinked?: boolean;
};

type ImportProgress = {
  total: number;
  status: "importing" | "done" | "error";
  message?: string;
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
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [unsyncingId, setUnsyncingId] = useState<string | null>(null);

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

  const selectAll = useCallback(() => {
    const importableIds = listings.filter((l) => !l.alreadyLinked).map((l) => l.externalListingId);
    if (selected.size === importableIds.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(importableIds));
    }
  }, [listings, selected.size]);

  const runImportAll = useCallback(async () => {
    const importableIds = listings.filter((l) => !l.alreadyLinked).map((l) => l.externalListingId);
    if (importableIds.length === 0) return;
    
    setImporting(true);
    setError(null);
    setDone(null);
    setProgress({ total: importableIds.length, status: "importing" });
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
        listingIds: importableIds,
      });
      const importedCount = res.imported?.length ?? 0;
      const skipped = res.skipped ?? [];
      const summary =
        res.summary ??
        (importedCount > 0
          ? `Imported ${importedCount} listing${importedCount === 1 ? "" : "s"}.`
          : "No listings were imported.");
      setDone(summary);
      setProgress({ total: importableIds.length, status: "done", message: summary });
      if (importedCount === 0 && (res.hint || skipped.length > 0)) {
        setError(res.hint ?? summary);
        setProgress({ total: importableIds.length, status: "error", message: res.hint ?? summary });
      }
      setSelected(new Set());
      await new Promise((r) => setTimeout(r, 1500));
      setProgress(null);
      await load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      const errorMsg = err?.error ?? "Import failed. Try again.";
      setError(errorMsg);
      setProgress({ total: importableIds.length, status: "error", message: errorMsg });
      await new Promise((r) => setTimeout(r, 2000));
      setProgress(null);
    } finally {
      setImporting(false);
    }
  }, [listings, importPath, load]);

  const unsyncPath = useMemo(() => `/api/channels/${provider}/unsync`, [provider]);

  const handleUnsync = useCallback(async (listingId: string) => {
    setUnsyncingId(listingId);
    setError(null);
    try {
      await apiDelete<{ ok: boolean; message?: string }>(
        `${unsyncPath}?listingId=${encodeURIComponent(listingId)}`
      );
      // Reload the listings to reflect the change
      await load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to unsync listing.");
    } finally {
      setUnsyncingId(null);
    }
  }, [unsyncPath, load]);

  const runImport = async () => {
    if (selected.size === 0) return;
    setImporting(true);
    setError(null);
    setDone(null);
    setProgress({ total: selected.size, status: "importing" });
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
      setProgress({ total: selected.size, status: "done", message: summary });
      if (importedCount === 0 && (res.hint || skipped.length > 0)) {
        setError(res.hint ?? summary);
        setProgress({ total: selected.size, status: "error", message: res.hint ?? summary });
      }
      setSelected(new Set());
      // Small delay to show completion before closing modal
      await new Promise((r) => setTimeout(r, 1500));
      setProgress(null);
      await load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      const errorMsg = err?.error ?? "Import failed. Try again.";
      setError(errorMsg);
      setProgress({ total: selected.size, status: "error", message: errorMsg });
      // Show error for a moment before closing
      await new Promise((r) => setTimeout(r, 2000));
      setProgress(null);
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
          <>
            {importable.length > 0 && (
              <View style={styles.selectAllRow}>
                <Pressable onPress={selectAll} style={styles.selectAllButton}>
                  <Text style={styles.selectAllText}>
                    {selected.size === importable.length ? "Deselect All" : "Select All"}
                  </Text>
                </Pressable>
                {importable.length > 1 && (
                  <Pressable
                    onPress={runImportAll}
                    style={styles.importAllButton}
                    disabled={importing}
                  >
                    <Text style={styles.importAllText}>Import All ({importable.length})</Text>
                  </Pressable>
                )}
              </View>
            )}
            {listings.map((l) => {
            const isSelected = selected.has(l.externalListingId);
            const isUnsyncing = unsyncingId === l.externalListingId;
            return (
              <View key={l.externalListingId} style={styles.row}>
                <Pressable
                  style={[styles.rowContent, l.alreadyLinked && styles.rowContentLinked]}
                  onPress={() => !l.alreadyLinked && toggle(l.externalListingId)}
                  disabled={l.alreadyLinked || isUnsyncing}
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
                {l.alreadyLinked && (
                  <Pressable
                    style={[styles.unsyncButton, isUnsyncing && styles.unsyncButtonDisabled]}
                    onPress={() => handleUnsync(l.externalListingId)}
                    disabled={isUnsyncing}
                  >
                    {isUnsyncing ? (
                      <ActivityIndicator size="small" color="#c62828" />
                    ) : (
                      <Text style={styles.unsyncButtonText}>Unsync</Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}
          </>
        )}

        {/* Progress Modal */}
        <Modal
          visible={progress !== null}
          transparent
          animationType="fade"
          onRequestClose={() => {}}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              {progress?.status === "importing" ? (
                <>
                  <ActivityIndicator size="large" color={theme.colors.primary} style={styles.modalSpinner} />
                  <Text style={styles.modalTitle}>Importing Listings</Text>
                  <Text style={styles.modalMessage}>
                    Importing {progress.total} listing{progress.total === 1 ? "" : "s"} to INW...
                  </Text>
                  <Text style={styles.modalHint}>This may take a moment</Text>
                </>
              ) : progress?.status === "done" ? (
                <>
                  <View style={styles.successIcon}>
                    <Text style={styles.successIconText}>✓</Text>
                  </View>
                  <Text style={styles.modalTitle}>Import Complete</Text>
                  <Text style={styles.modalMessage}>{progress.message}</Text>
                </>
              ) : progress?.status === "error" ? (
                <>
                  <View style={styles.errorIcon}>
                    <Text style={styles.errorIconText}>!</Text>
                  </View>
                  <Text style={styles.modalTitle}>Import Issue</Text>
                  <Text style={styles.modalMessage}>{progress.message}</Text>
                </>
              ) : null}
            </View>
          </View>
        </Modal>

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
  selectAllRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    marginBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  selectAllButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  selectAllText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  importAllButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  importAllText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e0e0e0",
  },
  rowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowContentLinked: {
    opacity: 0.6,
  },
  unsyncButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginLeft: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#c62828",
  },
  unsyncButtonDisabled: {
    opacity: 0.5,
  },
  unsyncButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#c62828",
  },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 32,
    width: "85%",
    maxWidth: 340,
    alignItems: "center",
  },
  modalSpinner: {
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
    textAlign: "center",
  },
  modalMessage: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  modalHint: {
    fontSize: 12,
    color: "#999",
    marginTop: 12,
    textAlign: "center",
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#e8f5e9",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  successIconText: {
    fontSize: 28,
    color: "#2e7d32",
    fontWeight: "700",
  },
  errorIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#ffebee",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  errorIconText: {
    fontSize: 28,
    color: "#c62828",
    fontWeight: "700",
  },
});
