import React, { useMemo, useState, useEffect } from "react";
import {
  Alert,
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  Modal,
} from "react-native";
import { theme as defaultTheme } from "@/lib/theme";
import {
  INVENTORY_TRACKING_MADE_TO_ORDER,
  INVENTORY_TRACKING_TRACKED,
  MAX_VARIANT_AXES,
  inferMatrixVaryFlags,
  listingGalleryPhotoChoices,
  normalizeVariantMatrix,
  optionsEqual,
  rebuildMatrixFromAxes,
  resolveImageAxisName,
  serializeVariantMatrix,
  skuSelectionKey,
  sumMatrixQuantities,
  type InventoryTracking,
  type VariantAxisDef,
  type VariantSkuRow,
} from "@/lib/listing-variant-matrix";

export type InventoryMode = "simple" | "options";
export type EditorSkuRow = VariantSkuRow & { enabled: boolean };

const DEFAULT_OPTION_PRESETS = ["Size", "Color", "Material"];
const PLACEHOLDER_COLOR = "#888888";

/** Web keyboard shortcuts; ignored on native. */
function webAccessKey(key: string): { accessKey?: string } {
  return { accessKey: key };
}

export function parseVariantsToEditor(raw: unknown): {
  mode: InventoryMode;
  axes: VariantAxisDef[];
  skus: EditorSkuRow[];
} {
  const matrix = normalizeVariantMatrix(raw);
  if (!matrix || matrix.axes.length === 0) {
    return { mode: "simple", axes: [], skus: [] };
  }
  const full = rebuildMatrixFromAxes(matrix.axes, matrix.skus, {
    pricesVary: matrix.pricesVary,
    quantitiesVary: matrix.quantitiesVary,
    skusVary: matrix.skusVary,
    imageAxis: matrix.imageAxis,
  });
  const enabledKeys = new Set(matrix.skus.map((s) => skuSelectionKey(s.options)));
  return {
    mode: "options",
    axes: full.axes,
    skus: full.skus.map((s) => ({
      ...s,
      enabled: enabledKeys.has(skuSelectionKey(s.options)),
    })),
  };
}

export function buildVariantsPayload(
  mode: InventoryMode,
  axes: VariantAxisDef[],
  skus: EditorSkuRow[]
): ReturnType<typeof serializeVariantMatrix> | null {
  if (mode !== "options") return null;
  const enabled = skus.filter((s) => s.enabled);
  if (axes.length === 0 || enabled.length === 0) return null;
  const rebuilt = rebuildMatrixFromAxes(axes, enabled, {
    imageAxis: resolveImageAxisName({ axes, skus: enabled }),
  });
  return serializeVariantMatrix({
    axes: rebuilt.axes,
    skus: rebuilt.skus.filter((s) => enabled.some((e) => optionsEqual(e.options, s.options))),
  });
}

export function sumEnabledSkus(skus: EditorSkuRow[]): number {
  return sumMatrixQuantities({
    axes: [],
    skus: skus.filter((s) => s.enabled),
  });
}

type ListingOptionsEditorProps = {
  mode: InventoryMode;
  onModeChange: (mode: InventoryMode) => void;
  axes: VariantAxisDef[];
  skus: EditorSkuRow[];
  onMatrixChange: (axes: VariantAxisDef[], skus: EditorSkuRow[]) => void;
  simpleQuantity: string;
  onSimpleQuantityChange: (value: string) => void;
  inventoryTracking: InventoryTracking;
  onInventoryTrackingChange: (value: InventoryTracking) => void;
  galleryPhotos?: string[];
  optionNamePresets?: string[];
  placeholderColor?: string;
  channelNotes?: string[];
};

function ChannelNotes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return (
    <>
      {notes.map((note) => (
        <Text key={note} style={styles.notice}>
          {note}
        </Text>
      ))}
    </>
  );
}

export function ListingOptionsEditor({
  mode,
  onModeChange,
  axes,
  skus,
  onMatrixChange,
  simpleQuantity,
  onSimpleQuantityChange,
  inventoryTracking,
  onInventoryTrackingChange,
  galleryPhotos = [],
  optionNamePresets = DEFAULT_OPTION_PRESETS,
  placeholderColor = PLACEHOLDER_COLOR,
  channelNotes,
}: ListingOptionsEditorProps) {
  const presets = optionNamePresets.length > 0 ? optionNamePresets : DEFAULT_OPTION_PRESETS;
  const madeToOrder = inventoryTracking === INVENTORY_TRACKING_MADE_TO_ORDER;
  const inferred = inferMatrixVaryFlags({ axes, skus });
  const [pricesVary, setPricesVary] = useState(inferred.pricesVary);
  const [quantitiesVary, setQuantitiesVary] = useState(true);
  const [skusVary, setSkusVary] = useState(inferred.skusVary);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftAxes, setDraftAxes] = useState<VariantAxisDef[]>([]);
  const [draftNewValues, setDraftNewValues] = useState<Record<number, string>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [bulkQty, setBulkQty] = useState("");
  const totalStock = sumEnabledSkus(skus);

  useEffect(() => {
    if (skus.some((s) => s.priceCents != null && s.priceCents > 0)) setPricesVary(true);
    if (skus.some((s) => Boolean(s.sku?.trim()))) setSkusVary(true);
  }, [skus]);
  const photoChoices = useMemo(
    () => listingGalleryPhotoChoices(galleryPhotos),
    [galleryPhotos]
  );

  const applyAxes = (nextAxes: VariantAxisDef[], nextSkus = skus) => {
    const full = rebuildMatrixFromAxes(nextAxes, nextSkus, {
      pricesVary,
      quantitiesVary,
      skusVary,
      imageAxis: resolveImageAxisName({ axes: nextAxes, skus: nextSkus }),
    });
    const prevEnabled = new Set(
      nextSkus.filter((s) => s.enabled).map((s) => skuSelectionKey(s.options))
    );
    const hadRows = nextSkus.length > 0;
    onMatrixChange(
      full.axes,
      full.skus.map((s) => ({
        ...s,
        enabled: hadRows ? prevEnabled.has(skuSelectionKey(s.options)) : true,
        ...(!pricesVary ? { priceCents: undefined } : {}),
        ...(!skusVary ? { sku: undefined } : {}),
      }))
    );
  };

  const patchSku = (key: string, patch: Partial<EditorSkuRow>) => {
    onMatrixChange(
      axes,
      skus.map((s) => (skuSelectionKey(s.options) === key ? { ...s, ...patch } : s))
    );
  };

  const openManage = () => {
    setDraftAxes(
      axes.length ? axes.map((a) => ({ ...a, values: [...a.values] })) : [{ name: "Size", values: [] }]
    );
    setDraftNewValues({});
    setManageOpen(true);
  };

  const closeManage = () => {
    setManageOpen(false);
    setDraftAxes([]);
    setDraftNewValues({});
  };

  const applyManage = () => {
    applyAxes(draftAxes);
    closeManage();
  };

  const toggleDraftPhoto = (axisIndex: number, value: string, url: string) => {
    setDraftAxes((prev) =>
      prev.map((a, i) => {
        if (i !== axisIndex) return { ...a, photosByValue: undefined };
        const current = a.photosByValue?.[value] ?? [];
        const next = current.includes(url) ? current.filter((u) => u !== url) : [...current, url];
        const photosByValue = { ...(a.photosByValue ?? {}), [value]: next };
        if (next.length === 0) delete photosByValue[value];
        return { ...a, photosByValue };
      })
    );
  };

  const addDraftValue = (ai: number) => {
    const val = (draftNewValues[ai] ?? "").trim();
    if (!val) return;
    setDraftAxes((prev) =>
      prev.map((a, i) =>
        i === ai && !a.values.some((v) => v.toLowerCase() === val.toLowerCase())
          ? { ...a, values: [...a.values, val] }
          : a
      )
    );
    setDraftNewValues((p) => ({ ...p, [ai]: "" }));
  };

  const enabledCount = skus.filter((s) => s.enabled).length;
  const summary =
    axes.length === 0
      ? "No options yet"
      : `${axes.map((a) => a.name || "Option").join(", ")} · ${enabledCount} combination${
          enabledCount === 1 ? "" : "s"
        }`;
  const photoAxisLive = resolveImageAxisName({ axes: draftAxes.length ? draftAxes : axes, skus });
  const firstPhotoAxisIndex = draftAxes.findIndex((a) => a.values.length > 0);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Inventory</Text>
      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeBtn, !madeToOrder && styles.modeBtnActive]}
          onPress={() => onInventoryTrackingChange(INVENTORY_TRACKING_TRACKED)}
        >
          <Text style={[styles.modeBtnText, !madeToOrder && styles.modeBtnTextActive]}>
            Track inventory
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, madeToOrder && styles.modeBtnActive]}
          onPress={() => onInventoryTrackingChange(INVENTORY_TRACKING_MADE_TO_ORDER)}
        >
          <Text style={[styles.modeBtnText, madeToOrder && styles.modeBtnTextActive]}>
            Made to order
          </Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        {madeToOrder
          ? "Buyers can order without a stock count. Sales do not decrement quantity."
          : "Each combination has its own quantity. Sales reduce that combination."}
      </Text>

      <View style={styles.modeRow}>
        <Pressable
          style={[styles.modeBtn, mode === "simple" && styles.modeBtnActive]}
          onPress={() => onModeChange("simple")}
        >
          <Text style={[styles.modeBtnText, mode === "simple" && styles.modeBtnTextActive]}>
            Simple quantity
          </Text>
        </Pressable>
        <Pressable
          style={[styles.modeBtn, mode === "options" && styles.modeBtnActive]}
          onPress={() => onModeChange("options")}
        >
          <Text style={[styles.modeBtnText, mode === "options" && styles.modeBtnTextActive]}>
            Options
          </Text>
        </Pressable>
      </View>

      {mode === "simple" ? (
        madeToOrder ? (
          <Text style={styles.hint}>Quantity is not required for made-to-order listings.</Text>
        ) : (
          <>
            <Text style={styles.label}>Quantity *</Text>
            <TextInput
              style={styles.input}
              placeholder="1"
              placeholderTextColor={placeholderColor}
              value={simpleQuantity}
              onChangeText={onSimpleQuantityChange}
              keyboardType="number-pad"
            />
          </>
        )
      ) : (
        <>
          <Text style={styles.summary}>{summary}</Text>
          <View style={styles.modeRow}>
            <Pressable
              style={[styles.modeBtn, styles.modeBtnActive]}
              onPress={openManage}
              {...webAccessKey("v")}
            >
              <Text style={[styles.modeBtnText, styles.modeBtnTextActive]}>
                {axes.length ? "Manage variations" : "Add options"}
              </Text>
            </Pressable>
          </View>
          <ChannelNotes notes={channelNotes} />

          {skus.length > 0 ? (
            <>
              <View style={styles.bulkRow}>
                {pricesVary ? (
                  <TextInput
                    style={[styles.input, styles.bulkInput]}
                    placeholder="Price"
                    placeholderTextColor={placeholderColor}
                    keyboardType="decimal-pad"
                    value={bulkPrice}
                    onChangeText={setBulkPrice}
                  />
                ) : null}
                {quantitiesVary && !madeToOrder ? (
                  <TextInput
                    style={[styles.input, styles.bulkInput]}
                    placeholder="Qty"
                    placeholderTextColor={placeholderColor}
                    keyboardType="number-pad"
                    value={bulkQty}
                    onChangeText={setBulkQty}
                  />
                ) : null}
                <Pressable
                  onPress={() => {
                    const priceN = parseFloat(bulkPrice);
                    const qtyN = parseInt(bulkQty, 10);
                    const priceCents =
                      Number.isFinite(priceN) && priceN > 0 ? Math.round(priceN * 100) : undefined;
                    const qty = Number.isFinite(qtyN) && qtyN >= 0 ? qtyN : undefined;
                    onMatrixChange(
                      axes,
                      skus.map((s) =>
                        s.enabled
                          ? {
                              ...s,
                              ...(pricesVary && priceCents != null ? { priceCents } : {}),
                              ...(quantitiesVary && !madeToOrder && qty != null ? { quantity: qty } : {}),
                            }
                          : s
                      )
                    );
                  }}
                >
                  <Text style={styles.addBtnText}>Apply to all enabled</Text>
                </Pressable>
              </View>
              <ScrollView horizontal style={styles.comboScroll}>
                <View>
                  <View style={styles.comboRow}>
                    <Text style={styles.headerCell}>Photo</Text>
                    {axes.map((a) => (
                      <Text key={a.name} style={styles.headerCell}>
                        {a.name || "Option"}
                      </Text>
                    ))}
                    {quantitiesVary && !madeToOrder ? (
                      <Text style={styles.headerCell}>Qty</Text>
                    ) : null}
                    {pricesVary ? <Text style={styles.headerCell}>Price</Text> : null}
                    {skusVary ? <Text style={styles.headerCell}>SKU</Text> : null}
                    <Text style={styles.headerCell}>On</Text>
                  </View>
                  {skus.map((row) => {
                    const key = skuSelectionKey(row.options);
                    const thumb = row.photos?.[0];
                    return (
                      <View key={key} style={[styles.comboRow, !row.enabled && styles.dim]}>
                        {thumb ? (
                          <Image source={{ uri: thumb }} style={styles.thumb} />
                        ) : (
                          <View style={styles.thumbPlaceholder} />
                        )}
                        {axes.map((a) => (
                          <Text key={a.name} style={styles.comboLabel}>
                            {row.options[a.name]}
                          </Text>
                        ))}
                        {quantitiesVary && !madeToOrder ? (
                          <TextInput
                            style={styles.qtyInput}
                            placeholder="0"
                            placeholderTextColor={placeholderColor}
                            keyboardType="number-pad"
                            value={row.quantity ? String(row.quantity) : ""}
                            onChangeText={(t) => {
                              const n = parseInt(t.replace(/\D/g, ""), 10);
                              patchSku(key, { quantity: Number.isNaN(n) ? 0 : n });
                            }}
                          />
                        ) : null}
                        {pricesVary ? (
                          <TextInput
                            style={styles.priceInput}
                            placeholder="Price"
                            placeholderTextColor={placeholderColor}
                            keyboardType="decimal-pad"
                            value={
                              row.priceCents != null && row.priceCents > 0
                                ? (row.priceCents / 100).toFixed(2)
                                : ""
                            }
                            onChangeText={(t) => {
                              const n = parseFloat(t);
                              patchSku(key, {
                                priceCents:
                                  Number.isFinite(n) && n > 0 ? Math.round(n * 100) : undefined,
                              });
                            }}
                          />
                        ) : null}
                        {skusVary ? (
                          <TextInput
                            style={styles.skuInput}
                            placeholder="SKU"
                            placeholderTextColor={placeholderColor}
                            value={row.sku ?? ""}
                            onChangeText={(t) => patchSku(key, { sku: t || undefined })}
                          />
                        ) : null}
                        <Pressable
                          onPress={() => patchSku(key, { enabled: !row.enabled })}
                          style={[styles.check, row.enabled && styles.checkOn]}
                        >
                          <Text style={styles.checkText}>{row.enabled ? "✓" : ""}</Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </ScrollView>
              {!madeToOrder ? (
                <Text style={styles.totalStock}>Total stock: {totalStock} units</Text>
              ) : null}
            </>
          ) : (
            <Text style={styles.hint}>
              Add option types and values, then Apply to generate combinations.
            </Text>
          )}
        </>
      )}

      <Modal visible={manageOpen} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView>
              <View style={styles.modalHeader}>
                <Text style={styles.sectionTitle}>Manage variations</Text>
                <Pressable onPress={closeManage}>
                  <Text style={styles.removeText}>Close</Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>
                Add up to {MAX_VARIANT_AXES} option types. Apply generates every combination.
              </Text>
              <ChannelNotes notes={channelNotes} />
              {draftAxes.map((axis, ai) => (
                <View key={`${axis.name}-${ai}`} style={styles.axisCard}>
                  <View style={styles.presetRow}>
                    {presets.map((preset) => (
                      <Pressable
                        key={preset}
                        style={[styles.presetChip, axis.name === preset && styles.presetChipActive]}
                        onPress={() =>
                          setDraftAxes((prev) =>
                            prev.map((a, i) => (i === ai ? { ...a, name: preset } : a))
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            axis.name === preset && styles.presetChipTextActive,
                          ]}
                        >
                          {preset}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      style={styles.removeBtn}
                      onPress={() => setDraftAxes((prev) => prev.filter((_, i) => i !== ai))}
                    >
                      <Text style={styles.removeText}>Remove</Text>
                    </Pressable>
                  </View>
                  {!presets.includes(axis.name) ? (
                    <TextInput
                      style={styles.input}
                      placeholder="Option name"
                      placeholderTextColor={placeholderColor}
                      value={axis.name}
                      onChangeText={(t) =>
                        setDraftAxes((prev) =>
                          prev.map((a, i) => (i === ai ? { ...a, name: t } : a))
                        )
                      }
                    />
                  ) : null}
                  <View style={styles.valueWrap}>
                    {axis.values.map((value) => (
                      <Pressable
                        key={value}
                        style={styles.valueChip}
                        onPress={() =>
                          Alert.alert("Remove value?", `Remove "${value}"?`, [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: () =>
                                setDraftAxes((prev) =>
                                  prev.map((a, i) =>
                                    i === ai
                                      ? { ...a, values: a.values.filter((v) => v !== value) }
                                      : a
                                  )
                                ),
                            },
                          ])
                        }
                      >
                        <Text style={styles.valueChipText}>{value} ×</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.addRow}>
                    <TextInput
                      style={[styles.input, styles.addValueInput]}
                      placeholder="Add value"
                      placeholderTextColor={placeholderColor}
                      value={draftNewValues[ai] ?? ""}
                      onChangeText={(t) => setDraftNewValues((p) => ({ ...p, [ai]: t }))}
                      onSubmitEditing={() => addDraftValue(ai)}
                      returnKeyType="done"
                    />
                    <Pressable style={styles.addBtn} onPress={() => addDraftValue(ai)}>
                      <Text style={styles.addBtnText}>+ Add</Text>
                    </Pressable>
                  </View>
                  {axis.values.length > 0 ? (
                    <View style={{ marginTop: 8 }}>
                      <Text style={styles.label}>Link photos to {axis.name || "this option"}</Text>
                      {photoChoices.length === 0 ? (
                        <Text style={styles.hint}>
                          Add listing photos in the gallery first, then tap them here.
                        </Text>
                      ) : (
                        axis.values.map((value) => (
                          <View key={value} style={{ marginBottom: 8 }}>
                            <Text style={styles.hint}>{value}</Text>
                            <View style={styles.photoRow}>
                              {photoChoices.map((url) => {
                                const selected = (axis.photosByValue?.[value] ?? []).includes(url);
                                return (
                                  <Pressable
                                    key={url}
                                    onPress={() => toggleDraftPhoto(ai, value, url)}
                                    style={[styles.photoChip, selected && styles.photoChipOn]}
                                    {...(ai === firstPhotoAxisIndex &&
                                    value === axis.values[0] &&
                                    url === photoChoices[0]
                                      ? webAccessKey("p")
                                      : {})}
                                  >
                                    <Image source={{ uri: url }} style={styles.photoChipImage} />
                                  </Pressable>
                                );
                              })}
                            </View>
                          </View>
                        ))
                      )}
                    </View>
                  ) : null}
                </View>
              ))}
              {draftAxes.length < MAX_VARIANT_AXES ? (
                <Pressable
                  style={styles.addBtn}
                  onPress={() =>
                    setDraftAxes((prev) => [
                      ...prev,
                      { name: presets[prev.length] ?? "Option", values: [] },
                    ])
                  }
                >
                  <Text style={styles.addBtnText}>+ Add option type</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={styles.toggleRow}
                onPress={() => {
                  const next = !pricesVary;
                  setPricesVary(next);
                  if (!next) {
                    onMatrixChange(
                      axes,
                      skus.map((s) => ({ ...s, priceCents: undefined }))
                    );
                  }
                }}
              >
                <Text style={styles.label}>Prices vary {pricesVary ? "✓" : ""}</Text>
              </Pressable>
              <Pressable
                style={styles.toggleRow}
                onPress={() => {
                  const next = !quantitiesVary;
                  setQuantitiesVary(next);
                  if (!next) {
                    const shared = skus.find((s) => s.enabled)?.quantity ?? 0;
                    onMatrixChange(
                      axes,
                      skus.map((s) => ({ ...s, quantity: shared }))
                    );
                  }
                }}
              >
                <Text style={styles.label}>Quantities vary {quantitiesVary ? "✓" : ""}</Text>
              </Pressable>
              <Pressable
                style={styles.toggleRow}
                onPress={() => {
                  const next = !skusVary;
                  setSkusVary(next);
                  if (!next) {
                    onMatrixChange(
                      axes,
                      skus.map((s) => ({ ...s, sku: undefined }))
                    );
                  }
                }}
              >
                <Text style={styles.label}>SKUs vary {skusVary ? "✓" : ""}</Text>
              </Pressable>
              {photoAxisLive ? (
                <Text style={styles.hint}>Photos are linked to {photoAxisLive}.</Text>
              ) : null}
              <Pressable style={[styles.addBtn, styles.applyBtn]} onPress={applyManage}>
                <Text style={styles.applyBtnText}>Apply</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: defaultTheme.colors.text,
    marginBottom: 8,
  },
  summary: { fontSize: 14, color: defaultTheme.colors.text, marginBottom: 8 },
  notice: {
    fontSize: 13,
    color: "#b45309",
    backgroundColor: "#fffbeb",
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  hint: { fontSize: 13, color: defaultTheme.colors.labelMuted, marginBottom: 10 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: defaultTheme.colors.text,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: defaultTheme.colors.text,
    marginBottom: 8,
  },
  modeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    alignItems: "center",
  },
  modeBtnActive: {
    borderColor: defaultTheme.colors.primary,
    backgroundColor: "#f0f7ff",
  },
  modeBtnText: { fontSize: 13, fontWeight: "600", color: defaultTheme.colors.labelMuted },
  modeBtnTextActive: { color: defaultTheme.colors.primary },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8, alignItems: "center" },
  presetChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 20,
  },
  presetChipActive: {
    borderColor: defaultTheme.colors.primary,
    backgroundColor: "#f0f7ff",
  },
  presetChipText: { fontSize: 14, color: defaultTheme.colors.labelMuted },
  presetChipTextActive: { color: defaultTheme.colors.primary, fontWeight: "600" },
  axisCard: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#fafafa",
  },
  valueWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  valueChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 16,
    backgroundColor: "#fff",
  },
  valueChipText: { fontSize: 13, color: defaultTheme.colors.text },
  removeBtn: { marginLeft: "auto" },
  removeText: { color: "#c62828", fontSize: 13 },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  addValueInput: { flex: 1, marginBottom: 0 },
  addBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: defaultTheme.colors.primary,
    borderRadius: 8,
    marginBottom: 8,
  },
  addBtnText: { color: defaultTheme.colors.primary, fontWeight: "600" },
  applyBtn: { backgroundColor: defaultTheme.colors.primary, marginTop: 8 },
  applyBtnText: { color: "#fff", fontWeight: "700", textAlign: "center" },
  comboScroll: { maxHeight: 360, marginTop: 8 },
  comboRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  headerCell: {
    width: 72,
    fontSize: 12,
    fontWeight: "700",
    color: defaultTheme.colors.labelMuted,
  },
  check: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: defaultTheme.colors.primary, borderColor: defaultTheme.colors.primary },
  checkText: { color: "#fff", fontWeight: "700" },
  comboLabel: { width: 72, fontSize: 13, color: defaultTheme.colors.text },
  dim: { opacity: 0.45 },
  qtyInput: {
    width: 52,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 15,
    textAlign: "center",
    color: defaultTheme.colors.text,
  },
  priceInput: {
    width: 72,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 14,
    color: defaultTheme.colors.text,
  },
  skuInput: {
    width: 88,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 13,
    color: defaultTheme.colors.text,
  },
  photoRow: { flexDirection: "row", gap: 4, flexWrap: "wrap" },
  photoChip: {
    width: 36,
    height: 36,
    borderRadius: 6,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ccc",
  },
  photoChipOn: { borderColor: defaultTheme.colors.primary, borderWidth: 2 },
  photoChipImage: { width: 36, height: 36 },
  thumb: { width: 28, height: 28, borderRadius: 4 },
  thumbPlaceholder: { width: 28, height: 28, borderRadius: 4, backgroundColor: "#eee" },
  bulkRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 8 },
  bulkInput: { width: 88, marginBottom: 0, paddingVertical: 8 },
  totalStock: {
    marginTop: 8,
    fontSize: 13,
    color: defaultTheme.colors.labelMuted,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "90%",
    padding: 16,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  toggleRow: { paddingVertical: 4 },
});
