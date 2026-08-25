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
  TextInput,
} from "react-native";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { promptShareListingsToFeed } from "@/lib/prompt-share-listings-to-feed";

type RemoteListing = {
  externalListingId: string;
  title: string;
  priceCents: number;
  quantity: number;
  photos: string[];
  alreadyLinked?: boolean;
  storeItemId?: string;
};

type ImportProgress = {
  total: number;
  current: number;
  percent: number;
  title?: string | null;
  status: "importing" | "result";
};

type ImportResultImported = {
  externalListingId?: string;
  storeItemId?: string;
  title?: string;
  photo?: string;
};

type ImportResultSkipped = {
  externalListingId: string;
  title?: string;
  photo?: string;
  step?: string;
  reason: string;
  hint?: string;
  retryable?: boolean;
};

type ImportApiResponse = {
  imported?: ImportResultImported[];
  skipped?: ImportResultSkipped[];
  summary?: string;
  hint?: string;
  jobId?: string;
};

type ImportJobStatus = {
  jobId?: string;
  id?: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  processed?: number;
  progress: number;
  currentTitle?: string | null;
  imported?: ImportResultImported[];
  skipped?: ImportResultSkipped[];
};

const LISTING_TIMEOUT_MS: Record<string, number> = {
  ebay: 120_000,
};
const IMPORT_TIMEOUT_MS = 120_000;

function easedImportPercent(percent: number, inFlight: boolean, processed: number): number {
  if (percent >= 100) return 100;
  if (inFlight && processed <= 0 && percent <= 0) return 4;
  return percent;
}

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
  const [resultImported, setResultImported] = useState<ImportResultImported[]>([]);
  const [resultSkipped, setResultSkipped] = useState<ImportResultSkipped[]>([]);
  const [resultTab, setResultTab] = useState<"on-inw" | "attention">("on-inw");
  const [unsyncingId, setUnsyncingId] = useState<string | null>(null);
  const [unsyncConfirm, setUnsyncConfirm] = useState<{ listingId: string; title: string } | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  
  // Auto-sync state (eBay only)
  const [autoSyncEnabled, setAutoSyncEnabled] = useState<boolean | null>(null);
  const [autoSyncLoading, setAutoSyncLoading] = useState(false);
  const [repairingCategories, setRepairingCategories] = useState(false);
  const [search, setSearch] = useState("");

  const importPath = useMemo(() => `/api/channels/${provider}/import`, [provider]);
  const listingTimeoutMs = LISTING_TIMEOUT_MS[provider] ?? 60_000;
  const refreshPath = useMemo(() => `/api/channels/${provider}/refresh`, [provider]);
  const notificationsPath = useMemo(() => `/api/channels/${provider}/notifications`, [provider]);

  // Check auto-sync status (eBay only)
  const checkAutoSync = useCallback(async () => {
    if (provider !== "ebay") return;
    try {
      const data = await apiGet<{ subscribed: boolean; webhookUrl?: string; events?: string[] }>(notificationsPath);
      setAutoSyncEnabled(data.subscribed);
    } catch {
      setAutoSyncEnabled(false);
    }
  }, [provider, notificationsPath]);

  // Enable auto-sync (eBay only)
  const enableAutoSync = useCallback(async () => {
    if (provider !== "ebay") return;
    setAutoSyncLoading(true);
    setError(null);
    try {
      const res = await apiPost<{ success: boolean; error?: string; message?: string }>(notificationsPath, {});
      if (res.success) {
        setAutoSyncEnabled(true);
        setDone(res.message || "Auto-sync enabled! Your eBay listings will now sync automatically.");
      } else {
        setError(res.error || "Failed to enable auto-sync");
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to enable auto-sync");
    } finally {
      setAutoSyncLoading(false);
    }
  }, [provider, notificationsPath]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Auto-refresh linked items when loading the import page
      const autoRefreshParam = provider === "ebay" || provider === "etsy" ? "?autoRefresh=1" : "";
      const data = await apiGet<{ 
        listings: RemoteListing[]; 
        error?: string;
        refreshed?: { updated: number; checked: number };
      }>(`${importPath}${autoRefreshParam}`);
      setListings(Array.isArray(data.listings) ? data.listings : []);
      // Show a brief notification if items were auto-updated
      if (data.refreshed && data.refreshed.updated > 0) {
        setDone(`Auto-synced ${data.refreshed.updated} item(s) from ${label}`);
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? `Could not load your ${label} listings.`);
    } finally {
      setLoading(false);
    }
  }, [importPath, label, provider]);

  const runCategoryRepair = useCallback(async () => {
    setRepairingCategories(true);
    setError(null);
    setDone(null);
    try {
      const res = await apiPost<{
        summary?: string;
        repaired?: { storeItemId: string; qtyRecovered?: boolean }[];
      }>("/api/channels/repair-categories", {}, IMPORT_TIMEOUT_MS);
      const repairedCount = res.repaired?.length ?? 0;
      const qtyRecovered = res.repaired?.filter((r) => r.qtyRecovered).length ?? 0;
      const summary =
        res.summary ??
        (repairedCount > 0
          ? `Repaired ${repairedCount} listing${repairedCount === 1 ? "" : "s"}.`
          : "No listings needed category repair.");
      const detail =
        qtyRecovered > 0
          ? `${summary} Restored inventory on ${qtyRecovered} listing${qtyRecovered === 1 ? "" : "s"}.`
          : summary;
      setDone(detail);
      await load();
    } catch (e: unknown) {
      const err = e as { error?: string; message?: string };
      setError(err?.error ?? err?.message ?? "Category repair failed.");
    } finally {
      setRepairingCategories(false);
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void checkAutoSync();
    }, [load, checkAutoSync])
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return listings;
    return listings.filter(
      (l) =>
        l.title.toLowerCase().includes(q) || l.externalListingId.toLowerCase().includes(q)
    );
  }, [listings, search]);

  const visibleImportable = useMemo(
    () => filteredListings.filter((l) => !l.alreadyLinked),
    [filteredListings]
  );

  const allVisibleImportableSelected =
    visibleImportable.length > 0 &&
    visibleImportable.every((l) => selected.has(l.externalListingId));

  const selectAll = useCallback(() => {
    const visibleImportableIds = filteredListings
      .filter((l) => !l.alreadyLinked)
      .map((l) => l.externalListingId);
    const allVisibleSelected =
      visibleImportableIds.length > 0 && visibleImportableIds.every((id) => selected.has(id));
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of visibleImportableIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleImportableIds) next.add(id);
      return next;
    });
  }, [filteredListings, selected]);

  const runSequentialImport = useCallback(
    async (listingIds: string[], merge = false) => {
      if (listingIds.length === 0) return;
      const titleFor = (id: string) => listings.find((l) => l.externalListingId === id)?.title;
      const photoFor = (id: string) => listings.find((l) => l.externalListingId === id)?.photos?.[0];

      setImporting(true);
      setError(null);
      setDone(null);
      setProgress({
        total: listingIds.length,
        current: 0,
        percent: 4,
        title: titleFor(listingIds[0]) ?? null,
        status: "importing",
      });

      try {
        const start = await apiPost<ImportJobStatus>(
          "/api/channels/import-job",
          { provider, listingIds },
          30_000
        );
        const jobId = start.jobId ?? start.id;
        if (!jobId) throw { error: "Could not start import." };

        const applyJob = (job: ImportJobStatus, inFlight: boolean) => {
          const processed = job.processed ?? job.completed + job.failed;
          setProgress({
            total: job.total || listingIds.length,
            current: processed,
            percent: easedImportPercent(job.progress ?? 0, inFlight, processed),
            title: job.currentTitle ?? titleFor(listingIds[processed] ?? listingIds[0]) ?? null,
            status: "importing",
          });
        };
        applyJob(start, true);

        const poll = setInterval(() => {
          void apiGet<ImportJobStatus>(`/api/channels/import-job/${jobId}`)
            .then((job) => applyJob(job, true))
            .catch(() => undefined);
        }, 800);

        const batchImported: ImportResultImported[] = [];
        const batchSkipped: ImportResultSkipped[] = [];

        try {
          for (const id of listingIds) {
            setProgress((prev) =>
              prev
                ? { ...prev, title: titleFor(id) ?? prev.title, status: "importing" }
                : prev
            );
            try {
              const res = await apiPost<ImportApiResponse>(
                importPath,
                { listingIds: [id], jobId },
                listingTimeoutMs
              );
              batchImported.push(...(res.imported ?? []));
              batchSkipped.push(...(res.skipped ?? []));
            } catch (e: unknown) {
              const err = e as { error?: string; message?: string };
              const reason = err?.error ?? err?.message ?? "Import failed. Try again.";
              batchSkipped.push({
                externalListingId: id,
                title: titleFor(id),
                photo: photoFor(id),
                step: "create",
                reason,
                retryable: true,
              });
            }
          }

          let imported = batchImported;
          let skipped = batchSkipped;
          try {
            const job = await apiGet<ImportJobStatus>(`/api/channels/import-job/${jobId}`);
            if (job.imported?.length) imported = job.imported;
            if (job.skipped?.length) skipped = job.skipped;
          } catch {
            /* use local batches */
          }

          const nextImported = merge ? [...resultImported, ...imported] : imported;
          const retried = new Set(listingIds);
          const nextSkipped = merge
            ? [...resultSkipped.filter((s) => !retried.has(s.externalListingId)), ...skipped]
            : skipped;

          setResultImported(nextImported);
          setResultSkipped(nextSkipped);
          setResultTab(
            nextImported.length === 0 && nextSkipped.length > 0 ? "attention" : "on-inw"
          );
          setSelected(new Set());
          setProgress({
            total: listingIds.length,
            current: listingIds.length,
            percent: 100,
            status: "result",
          });
        } finally {
          clearInterval(poll);
        }
      } catch (e: unknown) {
        const err = e as { error?: string; message?: string; status?: number };
        let errorMsg = err?.error ?? err?.message ?? "Import failed.";
        if (err.status === 0 || errorMsg.includes("timed out")) {
          errorMsg =
            "Import timed out. Some listings may still have been imported — refresh the list to check.";
        } else if (
          errorMsg.includes("network") ||
          errorMsg.includes("fetch") ||
          errorMsg.includes("reach")
        ) {
          errorMsg = "Unable to connect. Please check your internet connection and try again.";
        }
        setError(errorMsg);
        setProgress(null);
      } finally {
        setImporting(false);
      }
    },
    [listings, importPath, listingTimeoutMs, provider, resultImported, resultSkipped]
  );

  const runImportAll = useCallback(async () => {
    const importableIds = visibleImportable.map((l) => l.externalListingId);
    if (importableIds.length === 0) return;
    await runSequentialImport(importableIds);
  }, [visibleImportable, runSequentialImport]);

  const unsyncPath = useMemo(() => `/api/channels/${provider}/unsync`, [provider]);

  const showUnsyncConfirm = useCallback((listingId: string, title: string) => {
    setUnsyncConfirm({ listingId, title });
  }, []);

  const confirmUnsync = useCallback(async (removeFromINW: boolean) => {
    if (!unsyncConfirm) return;
    const { listingId } = unsyncConfirm;
    setUnsyncConfirm(null);
    setUnsyncingId(listingId);
    setError(null);
    try {
      await apiDelete<{ ok: boolean; message?: string }>(
        `${unsyncPath}?listingId=${encodeURIComponent(listingId)}&removeFromINW=${removeFromINW}`
      );
      // Reload the listings to reflect the change
      await load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to unsync listing.");
    } finally {
      setUnsyncingId(null);
    }
  }, [unsyncPath, load, unsyncConfirm]);

  const handleRefresh = useCallback(async (storeItemId: string, listingId: string) => {
    setRefreshingId(listingId);
    setError(null);
    try {
      const res = await apiPost<{ ok: boolean; message?: string; changes?: string[] }>(
        refreshPath,
        { storeItemId, pushToEtsy: true }
      );
      if (res.message) {
        setDone(res.message);
      }
      // Reload the listings
      await load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? `Failed to refresh from ${label}.`);
    } finally {
      setRefreshingId(null);
    }
  }, [refreshPath, load]);

  const runImport = async () => {
    if (selected.size === 0) return;
    await runSequentialImport(Array.from(selected));
  };

  const importable = listings.filter((l) => !l.alreadyLinked);
  const linkedCount = listings.length - importable.length;

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Import from {label}</Text>
        <Text style={styles.hint}>
          Select the {label} listings to bring into your INW store. Imported items stay in sync: a
          sale on either store updates inventory on both.
        </Text>

        {/* Auto-Sync Section (eBay only) */}
        {provider === "ebay" && autoSyncEnabled !== null && (
          <View style={styles.autoSyncSection}>
            {autoSyncEnabled ? (
              <View style={styles.autoSyncEnabled}>
                <Text style={styles.autoSyncIcon}>✓</Text>
                <Text style={styles.autoSyncText}>
                  Auto-sync is enabled. Changes on eBay will sync automatically.
                </Text>
              </View>
            ) : (
              <View style={styles.autoSyncDisabled}>
                <Text style={styles.autoSyncWarning}>
                  Auto-sync is not enabled. Enable it to automatically sync changes from eBay.
                </Text>
                <Pressable
                  style={[styles.autoSyncButton, autoSyncLoading && styles.autoSyncButtonDisabled]}
                  onPress={enableAutoSync}
                  disabled={autoSyncLoading}
                >
                  {autoSyncLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.autoSyncButtonText}>Enable Auto-Sync</Text>
                  )}
                </Pressable>
              </View>
            )}
          </View>
        )}

        {linkedCount > 0 && (
          <View style={styles.repairSection}>
            <Text style={styles.repairHint}>
              Fix missing or incorrect categories on {linkedCount} imported listing
              {linkedCount === 1 ? "" : "s"}. This also restores inventory when {label} still shows
              stock but INW marked the item sold out.
            </Text>
            <Pressable
              style={[styles.repairButton, repairingCategories && styles.repairButtonDisabled]}
              onPress={runCategoryRepair}
              disabled={repairingCategories || importing}
            >
              {repairingCategories ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.repairButtonText}>Fix Category Assignments</Text>
              )}
            </Pressable>
          </View>
        )}

        {loading ? (
          <ActivityIndicator style={styles.spinner} color={theme.colors.primary} />
        ) : listings.length === 0 ? (
          <Text style={styles.empty}>No {label} listings found.</Text>
        ) : (
          <>
            <TextInput
              style={styles.searchInput}
              placeholder={`Search ${label} listings...`}
              placeholderTextColor={theme.colors.placeholder}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {visibleImportable.length > 0 && (
              <View style={styles.selectAllRow}>
                <Pressable onPress={selectAll} style={styles.selectAllButton}>
                  <Text style={styles.selectAllText}>
                    {allVisibleImportableSelected ? "Deselect All" : "Select All"}
                  </Text>
                </Pressable>
                {visibleImportable.length > 1 && (
                  <Pressable
                    onPress={runImportAll}
                    style={styles.importAllButton}
                    disabled={importing}
                  >
                    <Text style={styles.importAllText}>
                      Import All ({visibleImportable.length})
                    </Text>
                  </Pressable>
                )}
              </View>
            )}
            {filteredListings.length === 0 ? (
              <Text style={styles.empty}>No listings match “{search.trim()}”.</Text>
            ) : (
              filteredListings.map((l) => {
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
                  <View style={styles.linkedActionsRow}>
                    {l.storeItemId && (
                      <Pressable
                        style={[styles.refreshButton, refreshingId === l.externalListingId && styles.refreshButtonDisabled]}
                        onPress={() => handleRefresh(l.storeItemId!, l.externalListingId)}
                        disabled={refreshingId === l.externalListingId}
                      >
                        {refreshingId === l.externalListingId ? (
                          <ActivityIndicator size="small" color={theme.colors.primary} />
                        ) : (
                          <Text style={styles.refreshButtonText}>Refresh</Text>
                        )}
                      </Pressable>
                    )}
                    <Pressable
                      style={[styles.unsyncButton, isUnsyncing && styles.unsyncButtonDisabled]}
                      onPress={() => showUnsyncConfirm(l.externalListingId, l.title)}
                      disabled={isUnsyncing}
                    >
                      {isUnsyncing ? (
                        <ActivityIndicator size="small" color="#c62828" />
                      ) : (
                        <Text style={styles.unsyncButtonText}>Unsync</Text>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
            )}
          </>
        )}

        {/* Progress / result modal */}
        <Modal
          visible={progress !== null}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (progress?.status !== "importing") {
              setProgress(null);
            }
          }}
        >
          <View style={styles.modalOverlay}>
            <View
              style={[
                styles.modalContent,
                progress?.status === "result" && styles.resultModalContent,
              ]}
            >
              {progress?.status === "importing" ? (
                <>
                  <Text style={styles.modalTitle}>Importing listings</Text>
                  <View style={styles.percentTrack}>
                    <View style={[styles.percentFill, { width: `${Math.max(0, Math.min(100, progress.percent))}%` }]} />
                  </View>
                  <Text style={styles.percentLabel}>
                    {Math.round(progress.percent)}%
                    {progress.total > 0 ? `  ·  ${progress.current} of ${progress.total}` : ""}
                  </Text>
                  <Text style={styles.modalMessage} numberOfLines={2}>
                    {progress.title
                      ? `${provider === "ebay" ? "Migrating" : "Importing"} ${progress.title}…`
                      : "Preparing import…"}
                  </Text>
                </>
              ) : progress?.status === "result" ? (
                <>
                  <View style={styles.resultTabs}>
                    <Pressable
                      style={[styles.resultTab, resultTab === "on-inw" && styles.resultTabOn]}
                      onPress={() => setResultTab("on-inw")}
                    >
                      <Text style={[styles.resultTabText, resultTab === "on-inw" && styles.resultTabTextOn]}>
                        On INW{resultImported.length ? ` (${resultImported.length})` : ""}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.resultTab, resultTab === "attention" && styles.resultTabOn]}
                      onPress={() => setResultTab("attention")}
                    >
                      <Text style={[styles.resultTabText, resultTab === "attention" && styles.resultTabTextOn]}>
                        Needs attention{resultSkipped.length ? ` (${resultSkipped.length})` : ""}
                      </Text>
                    </Pressable>
                  </View>
                  <ScrollView style={styles.resultList} contentContainerStyle={styles.resultListContent}>
                    {resultTab === "on-inw" ? (
                      resultImported.length === 0 ? (
                        <Text style={styles.modalMessage}>No listings were added to INW.</Text>
                      ) : (
                        resultImported.map((row, i) => (
                          <View key={row.storeItemId ?? `${row.externalListingId}-${i}`} style={styles.resultRow}>
                            {row.photo ? (
                              <Image source={{ uri: row.photo }} style={styles.resultThumb} />
                            ) : (
                              <View style={[styles.resultThumb, styles.thumbEmpty]} />
                            )}
                            <Text style={styles.resultRowTitle} numberOfLines={2}>
                              {row.title ?? "Listing"}
                            </Text>
                          </View>
                        ))
                      )
                    ) : resultSkipped.length === 0 ? (
                      <Text style={styles.modalMessage}>Everything imported cleanly.</Text>
                    ) : (
                      resultSkipped.map((row) => (
                        <View key={row.externalListingId} style={styles.resultSkipBlock}>
                          <View style={styles.resultRow}>
                            {row.photo ? (
                              <Image source={{ uri: row.photo }} style={styles.resultThumb} />
                            ) : (
                              <View style={[styles.resultThumb, styles.thumbEmpty]} />
                            )}
                            <Text style={styles.resultRowTitle} numberOfLines={2}>
                              {row.title ?? row.externalListingId}
                            </Text>
                          </View>
                          <Text style={styles.resultReason}>{row.reason}</Text>
                          {row.hint ? <Text style={styles.resultHint}>{row.hint}</Text> : null}
                        </View>
                      ))
                    )}
                  </ScrollView>
                  {resultTab === "on-inw" ? (
                    <>
                      {resultImported.length > 0 ? (
                        <Pressable
                          style={styles.modalDismissButton}
                          onPress={() => {
                            const ids = resultImported
                              .map((row) => row.storeItemId)
                              .filter((id): id is string => Boolean(id));
                            if (ids.length > 0) promptShareListingsToFeed(ids);
                          }}
                        >
                          <Text style={styles.modalDismissButtonText}>Share to feed</Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        style={resultImported.length > 0 ? styles.modalSecondaryButton : styles.modalDismissButton}
                        onPress={async () => {
                          setProgress(null);
                          await load();
                        }}
                      >
                        <Text
                          style={
                            resultImported.length > 0
                              ? styles.modalSecondaryButtonText
                              : styles.modalDismissButtonText
                          }
                        >
                          Done
                        </Text>
                      </Pressable>
                    </>
                  ) : (
                    <>
                      {resultSkipped.some((s) => s.retryable) ? (
                        <Pressable
                          style={[styles.modalDismissButton, importing && { opacity: 0.5 }]}
                          disabled={importing}
                          onPress={() => {
                            const ids = resultSkipped.filter((s) => s.retryable).map((s) => s.externalListingId);
                            void runSequentialImport(ids, true);
                          }}
                        >
                          <Text style={styles.modalDismissButtonText}>
                            {importing
                              ? "Retrying…"
                              : `Retry ${resultSkipped.filter((s) => s.retryable).length} listing${
                                  resultSkipped.filter((s) => s.retryable).length === 1 ? "" : "s"
                                }`}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        style={styles.modalSecondaryButton}
                        onPress={async () => {
                          setProgress(null);
                          await load();
                        }}
                      >
                        <Text style={styles.modalSecondaryButtonText}>Done</Text>
                      </Pressable>
                    </>
                  )}
                </>
              ) : null}
            </View>
          </View>
        </Modal>

        {/* Unsync Confirmation Modal */}
        <Modal
          visible={unsyncConfirm !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setUnsyncConfirm(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.unsyncConfirmIcon}>
                <Text style={styles.unsyncConfirmIconText}>?</Text>
              </View>
              <Text style={styles.modalTitle}>Unsync Listing</Text>
              <Text style={styles.modalMessage}>
                Would you like this item removed from INW Community?
              </Text>
              <Text style={styles.unsyncItemTitle} numberOfLines={2}>
                {unsyncConfirm?.title}
              </Text>
              <View style={styles.modalButtonRow}>
                <Pressable
                  style={styles.unsyncNoButton}
                  onPress={() => confirmUnsync(false)}
                >
                  <Text style={styles.unsyncNoButtonText}>No, Keep It</Text>
                </Pressable>
                <Pressable
                  style={styles.unsyncYesButton}
                  onPress={() => confirmUnsync(true)}
                >
                  <Text style={styles.unsyncYesButtonText}>Yes, Remove</Text>
                </Pressable>
              </View>
              <Pressable
                style={styles.unsyncCancelButton}
                onPress={() => setUnsyncConfirm(null)}
              >
                <Text style={styles.unsyncCancelButtonText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {done && !error && progress === null ? <Text style={styles.success}>{done}</Text> : null}
        {error && progress === null ? <Text style={styles.err}>{error}</Text> : null}
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
  autoSyncSection: {
    marginBottom: 20,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
  },
  autoSyncEnabled: {
    flexDirection: "row",
    alignItems: "center",
  },
  autoSyncIcon: {
    fontSize: 16,
    color: "#2e7d32",
    marginRight: 8,
    fontWeight: "700",
  },
  autoSyncText: {
    fontSize: 13,
    color: "#2e7d32",
    flex: 1,
  },
  autoSyncDisabled: {
    alignItems: "center",
  },
  autoSyncWarning: {
    fontSize: 13,
    color: "#f57c00",
    textAlign: "center",
    marginBottom: 12,
  },
  autoSyncButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
  },
  autoSyncButtonDisabled: {
    opacity: 0.6,
  },
  autoSyncButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  repairSection: {
    marginBottom: 20,
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f0f4ff",
    borderWidth: 1,
    borderColor: "#c5d4f7",
  },
  repairHint: {
    fontSize: 13,
    color: "#444",
    marginBottom: 12,
    lineHeight: 18,
  },
  repairButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 6,
    alignItems: "center",
  },
  repairButtonDisabled: {
    opacity: 0.6,
  },
  repairButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  spinner: { marginVertical: 16 },
  empty: { fontSize: 14, color: "#666", marginTop: 16 },
  searchInput: {
    width: "100%",
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#000",
    marginBottom: 8,
  },
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
  linkedActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 8,
  },
  refreshButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    marginRight: 6,
  },
  refreshButtonDisabled: {
    opacity: 0.5,
  },
  refreshButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.primary,
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
    padding: 24,
    width: "85%",
    maxWidth: 340,
    alignItems: "stretch",
  },
  resultModalContent: {
    width: "92%",
    maxWidth: 420,
    maxHeight: "85%",
    padding: 16,
  },
  percentTrack: {
    width: "100%",
    height: 10,
    backgroundColor: theme.colors.cream,
    borderRadius: 6,
    marginTop: 12,
    marginBottom: 10,
    overflow: "hidden",
  },
  percentFill: {
    height: "100%",
    backgroundColor: theme.colors.secondary,
    borderRadius: 6,
  },
  percentLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  resultTabs: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e0e0e0",
    marginBottom: 12,
  },
  resultTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  resultTabOn: {
    borderBottomWidth: 2,
    borderBottomColor: theme.colors.secondary,
  },
  resultTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888",
  },
  resultTabTextOn: {
    color: theme.colors.heading,
  },
  resultList: {
    maxHeight: 280,
    width: "100%",
  },
  resultListContent: {
    paddingBottom: 8,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  resultThumb: {
    width: 48,
    height: 48,
    borderRadius: 6,
    backgroundColor: "#f0f0f0",
  },
  resultRowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
  },
  resultSkipBlock: {
    marginBottom: 14,
  },
  resultReason: {
    fontSize: 13,
    color: "#444",
    marginLeft: 58,
  },
  resultHint: {
    fontSize: 12,
    color: "#888",
    marginLeft: 58,
    marginTop: 4,
  },
  progressBarContainer: {
    width: "100%",
    height: 8,
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
    marginVertical: 16,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: theme.colors.primary,
    borderRadius: 4,
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
  modalDismissButton: {
    marginTop: 16,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: "center",
    width: "100%",
  },
  modalDismissButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  modalButtonRow: {
    flexDirection: "row",
    marginTop: 20,
    gap: 12,
  },
  modalSecondaryButton: {
    marginTop: 12,
    width: "100%",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    alignItems: "center",
  },
  modalSecondaryButtonText: {
    color: "#666",
    fontWeight: "600",
    fontSize: 14,
  },
  modalRetryButton: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  modalRetryButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  unsyncConfirmIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fff3e0",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  unsyncConfirmIconText: {
    fontSize: 28,
    color: "#ef6c00",
    fontWeight: "700",
  },
  unsyncItemTitle: {
    fontSize: 13,
    color: "#888",
    textAlign: "center",
    marginTop: 8,
    fontStyle: "italic",
  },
  unsyncNoButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
  },
  unsyncNoButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  unsyncYesButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#c62828",
    alignItems: "center",
  },
  unsyncYesButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  unsyncCancelButton: {
    marginTop: 12,
    paddingVertical: 8,
  },
  unsyncCancelButtonText: {
    color: "#888",
    fontSize: 14,
  },
});
