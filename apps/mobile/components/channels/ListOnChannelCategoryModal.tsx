import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
} from "react-native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { RadioOptionList } from "@/components/listing/RadioOptionList";
import { SelectField } from "@/components/listing/SelectField";
import {
  ETSY_WHEN_MADE_OPTIONS,
  ETSY_WHO_MADE_OPTIONS,
  isEtsyWhoMade,
  normalizeEtsyWhenMade,
  type EtsyWhenMade,
  type EtsyWhoMade,
} from "@/lib/etsy-listing-options";
import {
  itemNeedsEtsyListingDetails,
  mergeListOnCategoryAssignment,
  type ListOnCategoryAssignment,
  type ListOnCategoryStep,
} from "@/lib/list-on-channel-category";
import {
  ebayAspectUsesDropdown,
  isOftenRequiredEbayAspectName,
  missingEbayAspectsForListOn,
  prepareAspectRowsForForm,
  preserveEbayAspectValues,
  type CategoryAspectSchema,
} from "@/lib/ebay-aspect-prep";

type CategoryChoice = { id: string; name: string; path: string };
type ListingAspect = { name: string; value: string };

function parseItemAspects(raw: unknown): ListingAspect[] {
  if (!Array.isArray(raw)) return [];
  const out: ListingAspect[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as { name?: unknown; value?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const value = typeof rec.value === "string" ? rec.value.trim() : "";
    if (name) out.push({ name, value });
  }
  return out;
}

type Props = {
  visible: boolean;
  steps: ListOnCategoryStep[];
  onClose: () => void;
  onComplete: (assignments: ListOnCategoryAssignment[]) => Promise<void>;
  heading?: string;
  completeLabel?: string;
};

export function ListOnChannelCategoryModal({
  visible,
  steps,
  onClose,
  onComplete,
  heading,
  completeLabel,
}: Props) {
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignmentsByItem, setAssignmentsByItem] = useState<Record<string, ListOnCategoryAssignment>>(
    {}
  );
  const [categoryId, setCategoryId] = useState("");
  const [categoryLabel, setCategoryLabel] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CategoryChoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [etsyWhoMade, setEtsyWhoMade] = useState<EtsyWhoMade>("i_did");
  const [etsyWhenMade, setEtsyWhenMade] = useState<EtsyWhenMade>("made_to_order");
  const [categoryAspects, setCategoryAspects] = useState<CategoryAspectSchema[]>([]);
  const [aspects, setAspects] = useState<ListingAspect[]>([]);
  const [aspectsLoading, setAspectsLoading] = useState(false);
  const [aspectsError, setAspectsError] = useState<string | null>(null);

  const step = steps[index];
  const isLast = index === steps.length - 1;
  const providerLabel = step?.provider === "etsy" ? "Etsy" : "eBay";
  const showEtsyDetails = step?.provider === "etsy" && itemNeedsEtsyListingDetails(step.item);
  const missingEbayAspects =
    step?.provider === "ebay" ? missingEbayAspectsForListOn(categoryAspects, aspects) : [];
  const canContinue =
    Boolean(categoryId) &&
    !aspectsLoading &&
    (step?.provider !== "ebay" || (categoryAspects.length > 0 && missingEbayAspects.length === 0)) &&
    (step?.provider !== "etsy" ||
      !showEtsyDetails ||
      (isEtsyWhoMade(etsyWhoMade) && normalizeEtsyWhenMade(etsyWhenMade) != null));

  useEffect(() => {
    if (!visible) {
      setIndex(0);
      setAssignmentsByItem({});
      setSubmitting(false);
      setError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (!step) return;
    if (step.provider === "etsy" && step.item.etsyTaxonomyId) {
      setCategoryId(String(step.item.etsyTaxonomyId));
      setCategoryLabel("");
    } else if (step.provider === "ebay" && step.item.ebayCategoryId) {
      setCategoryId(String(step.item.ebayCategoryId));
      setCategoryLabel("");
    } else {
      setCategoryId("");
      setCategoryLabel("");
    }
    setQuery("");
    setResults([]);
    setSearchError(null);
    setEtsyWhoMade(isEtsyWhoMade(step.item.etsyWhoMade) ? step.item.etsyWhoMade : "i_did");
    setEtsyWhenMade(normalizeEtsyWhenMade(step.item.etsyWhenMade) ?? "made_to_order");
    setCategoryAspects([]);
    setAspects([]);
    setAspectsError(null);
    setAspectsLoading(false);
    setError(null);
  }, [
    index,
    step?.item.id,
    step?.provider,
    step?.item.etsyTaxonomyId,
    step?.item.ebayCategoryId,
    step?.item.etsyWhoMade,
    step?.item.etsyWhenMade,
  ]);

  useEffect(() => {
    if (!visible || !step || step.provider !== "ebay" || !categoryId) {
      if (step?.provider !== "ebay" || !categoryId) {
        setCategoryAspects([]);
        setAspects([]);
        setAspectsError(null);
        setAspectsLoading(false);
      }
      return;
    }
    let cancelled = false;
    setAspectsLoading(true);
    setAspectsError(null);
    apiGet<{
      aspects?: CategoryAspectSchema[];
      error?: string;
      warning?: string;
      rateLimited?: boolean;
    }>(
      `/api/channels/ebay/category-aspects?categoryId=${encodeURIComponent(categoryId)}&storeItemId=${encodeURIComponent(step.item.id)}`
    )
      .then((data) => {
        if (cancelled) return;
        const list = data.aspects ?? [];
        setCategoryAspects(list);
        setAspects((prev) =>
          list.length > 0
            ? preserveEbayAspectValues(
                prepareAspectRowsForForm(list, parseItemAspects(step.item.aspects), step.item.title),
                prev
              )
            : []
        );
        setAspectsError(
          list.length > 0
            ? null
            : data.warning ??
                data.error ??
                "eBay did not return official values for this category. Change the category and try again."
        );
      })
      .catch(() => {
        if (cancelled) return;
        setCategoryAspects([]);
        setAspects([]);
        setAspectsError("Could not load eBay's official values. Change the category or try again.");
      })
      .finally(() => {
        if (!cancelled) setAspectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, step?.provider, step?.item.id, step?.item.title, categoryId]);

  useEffect(() => {
    const q = query.trim();
    if (!visible || !step || categoryId || q.length < 2) {
      if (q.length < 2) setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const t = setTimeout(() => {
      const path =
        step.provider === "etsy"
          ? `/api/channels/etsy/categories?q=${encodeURIComponent(q)}`
          : `/api/channels/ebay/categories?q=${encodeURIComponent(q)}`;
      apiGet<{
        categories?: Array<{
          taxonomyId?: number;
          categoryId?: string;
          categoryName?: string;
          categoryPath?: string;
        }>;
      }>(path)
        .then((data) => {
          if (cancelled) return;
          const mapped: CategoryChoice[] = (data.categories ?? [])
            .map((c) => {
              const id =
                step.provider === "etsy"
                  ? c.taxonomyId != null
                    ? String(c.taxonomyId)
                    : ""
                  : String(c.categoryId ?? "");
              const name = c.categoryName ?? "";
              if (!id || !name) return null;
              return { id, name, path: c.categoryPath || name };
            })
            .filter((c): c is CategoryChoice => c != null);
          setResults(mapped);
        })
        .catch((e: { error?: string }) => {
          if (!cancelled) {
            setResults([]);
            setSearchError(e?.error ?? "Category search failed.");
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, categoryId, visible, step]);

  async function goNext() {
    if (!step || !categoryId) return;
    const patch: ListOnCategoryAssignment = { storeItemId: step.item.id };
    if (step.provider === "etsy") {
      patch.etsyTaxonomyId = Number(categoryId);
      if (showEtsyDetails) {
        patch.etsyWhoMade = etsyWhoMade;
        patch.etsyWhenMade = etsyWhenMade;
      }
    } else {
      patch.ebayCategoryId = Number(categoryId);
      patch.aspects = aspects;
    }
    const nextMap = {
      ...assignmentsByItem,
      [step.item.id]: mergeListOnCategoryAssignment(assignmentsByItem[step.item.id], patch),
    };
    setAssignmentsByItem(nextMap);
    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onComplete(Object.values(nextMap));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list this item.");
      setSubmitting(false);
    }
  }

  if (!step) return null;
  const photo = step.item.photos?.[0];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={submitting ? undefined : onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{heading ?? `Select ${providerLabel} category`}</Text>
          {steps.length > 1 ? (
            <Text style={styles.progress}>
              {index + 1} of {steps.length}
            </Text>
          ) : null}
          <View style={styles.itemRow}>
            {photo ? <Image source={{ uri: photo }} style={styles.thumb} /> : <View style={styles.thumb} />}
            <Text style={styles.itemTitle} numberOfLines={2}>
              {step.item.title}
            </Text>
          </View>
          <Text style={styles.hint}>
            {step.provider === "ebay"
              ? "eBay needs a category and required item specifics before this item can be listed."
              : `${providerLabel} needs a category before this item can be listed.`}
          </Text>
          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            {categoryId ? (
              <View style={styles.chip}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.chipLabel} numberOfLines={2}>
                    {categoryLabel || `${providerLabel} category #${categoryId}`}
                  </Text>
                  <Text style={styles.hint}>{providerLabel} category #{categoryId}</Text>
                </View>
                <Pressable
                  onPress={() => {
                    setCategoryId("");
                    setCategoryLabel("");
                    setCategoryAspects([]);
                    setAspects([]);
                    setAspectsError(null);
                  }}
                  disabled={submitting}
                >
                  <Text style={styles.change}>Change</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={`Search ${providerLabel} categories…`}
                  placeholderTextColor="#888"
                  editable={!submitting}
                  autoCorrect={false}
                />
                {searching ? <ActivityIndicator color={theme.colors.primary} /> : null}
                {searchError ? <Text style={styles.error}>{searchError}</Text> : null}
                {results.map((c) => (
                  <Pressable
                    key={c.id}
                    style={styles.result}
                    onPress={() => {
                      setCategoryId(c.id);
                      setCategoryLabel(c.path || c.name);
                      setQuery("");
                      setResults([]);
                    }}
                  >
                    <Text style={styles.resultName}>{c.name}</Text>
                    {c.path !== c.name ? (
                      <Text style={styles.hint} numberOfLines={1}>
                        {c.path}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </>
            )}
            {step.provider === "ebay" && categoryId ? (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.fieldLabel}>Item specifics</Text>
                <Text style={styles.hint}>
                  Fill in the details eBay requires for this category. Required fields are marked with *.
                </Text>
                {aspectsLoading ? <ActivityIndicator color={theme.colors.primary} /> : null}
                {aspectsError ? <Text style={styles.error}>{aspectsError}</Text> : null}
                {!aspectsLoading && !aspectsError && aspects.length === 0 ? (
                  <Text style={styles.hint}>This category has no required item specifics.</Text>
                ) : null}
                {aspects.map((row, index) => {
                  const schema = categoryAspects.find(
                    (aspect) => aspect.name.trim().toLowerCase() === row.name.trim().toLowerCase()
                  );
                  const required = Boolean(schema?.required) || isOftenRequiredEbayAspectName(row.name);
                  const suggestions = schema?.suggestedValues ?? [];
                  const useDropdown = ebayAspectUsesDropdown(schema);
                  const isMulti = schema?.cardinality === "MULTI";
                  const label = `${row.name}${required ? " *" : ""}`;
                  if (useDropdown) {
                    return (
                      <SelectField
                        key={`${row.name}-${index}`}
                        label={label}
                        value={row.value}
                        options={suggestions.map((value) => ({ value, label: value }))}
                        onChange={(value) =>
                          setAspects((prev) =>
                            prev.map((current, i) => (i === index ? { ...current, value } : current))
                          )
                        }
                        placeholder={required ? "Select value (required)" : "Select value"}
                      />
                    );
                  }
                  return (
                    <View key={`${row.name}-${index}`} style={{ marginBottom: 8 }}>
                      <Text style={styles.fieldLabel}>{label}</Text>
                      <TextInput
                        style={styles.input}
                        value={row.value}
                        onChangeText={(value) =>
                          setAspects((prev) =>
                            prev.map((current, i) => (i === index ? { ...current, value } : current))
                          )
                        }
                        placeholder={
                          isMulti
                            ? required
                              ? "Values (comma-separated, required)"
                              : "Values (comma-separated)"
                            : required
                              ? "Value (required)"
                              : "Value"
                        }
                        placeholderTextColor="#888"
                        editable={!submitting}
                      />
                      {isMulti ? (
                        <Text style={styles.hint}>Separate multiple values with commas.</Text>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            ) : null}
            {showEtsyDetails ? (
              <View style={{ marginTop: 12 }}>
                <Text style={styles.fieldLabel}>Who made it?</Text>
                <RadioOptionList
                  options={ETSY_WHO_MADE_OPTIONS}
                  value={etsyWhoMade}
                  onChange={(v) => setEtsyWhoMade(v as EtsyWhoMade)}
                />
                <SelectField
                  label="When was it made?"
                  value={etsyWhenMade}
                  options={ETSY_WHEN_MADE_OPTIONS}
                  onChange={(v) => setEtsyWhenMade(v as EtsyWhenMade)}
                />
              </View>
            ) : null}
          </ScrollView>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Pressable onPress={onClose} disabled={submitting}>
              <Text style={styles.cancel}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.listBtn, (!canContinue || submitting) && { opacity: 0.5 }]}
              disabled={!canContinue || submitting}
              onPress={() => void goNext()}
            >
              <Text style={styles.listBtnText}>
                {submitting ? "Saving…" : isLast ? completeLabel ?? "List" : "Next"}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    maxHeight: "88%",
  },
  title: { fontSize: 18, fontWeight: "700", color: theme.colors.heading },
  progress: { fontSize: 12, color: theme.colors.labelMuted, marginTop: 4 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, marginBottom: 8 },
  thumb: { width: 48, height: 48, borderRadius: 8, backgroundColor: "#e5e7eb" },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: "600", color: "#111" },
  hint: { fontSize: 12, color: theme.colors.labelMuted, marginBottom: 8 },
  body: { maxHeight: 360 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 8,
    color: theme.colors.text,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#f7f7f7",
    padding: 12,
    marginBottom: 8,
  },
  chipLabel: { fontSize: 14, fontWeight: "600", color: "#000" },
  change: { color: "#dc2626", fontSize: 14, fontWeight: "600" },
  result: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    backgroundColor: "#fff",
  },
  resultName: { fontSize: 14, fontWeight: "600", color: "#000" },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: "#000", marginBottom: 8 },
  error: { fontSize: 13, color: "#dc2626", marginTop: 8 },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 16,
    marginTop: 12,
  },
  cancel: { fontSize: 15, color: "#6b7280" },
  listBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  listBtnText: { color: "#fff", fontWeight: "700" },
});
