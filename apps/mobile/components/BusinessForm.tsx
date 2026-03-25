import { useEffect, useRef, useState } from "react";
import * as ImageManipulator from "expo-image-manipulator";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { theme } from "@/lib/theme";
import {
  MAX_BUSINESS_GALLERY_PHOTOS,
  MAX_UPLOAD_FILE_BYTES,
  formatMaxUploadSizeLabel,
} from "@/lib/upload-limits";
import { PREBUILT_CITIES } from "@/lib/prebuilt-cities";
import { apiPost, apiPatch, apiUploadFile, apiGet, getToken } from "@/lib/api";
import {
  normalizeSubcategoriesByPrimary,
  parseSubcategoriesByPrimary,
} from "@/lib/business-categories-align";
import {
  BUSINESS_CATEGORIES,
  getSubcategoriesForBusinessCategory,
} from "@/lib/business-category-presets";
import type { CategoryPreset } from "@/lib/business-category-suggest";
import { BusinessCategoryPrimaryPicker } from "@/components/BusinessCategoryPrimaryPicker";

/** Visible tan accent for gallery upload progress on light backgrounds (cream token is too low-contrast). */
const GALLERY_UPLOAD_SPINNER = "#C4956A";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

type HoursRecord = Partial<Record<(typeof DAYS)[number], string>>;

function toFullUrl(url: string): string {
  return url.startsWith("http")
    ? url
    : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Resize/compress before upload for faster transfers; output JPEG. */
async function prepareBusinessImage(uri: string): Promise<{ uri: string; type: string }> {
  try {
    const r = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 2048 } }],
      { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG }
    );
    return { uri: r.uri, type: "image/jpeg" };
  } catch {
    return { uri, type: "image/jpeg" };
  }
}

function uploadErrorMessage(e: unknown, fallback: string, onDraftSubmit?: boolean, status?: number): string {
  const raw = (e as { error?: string }).error;
  const msg = typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  if (
    onDraftSubmit &&
    status === 403 &&
    (msg.includes("Business, Seller, or Subscribe") || msg.includes("plan required"))
  ) {
    return "Photo upload requires an active signup step. Go back and confirm your account, or finish the previous screen, then try again.";
  }
  return msg;
}

function parseHours(ho: unknown): HoursRecord {
  if (!ho || typeof ho !== "object") return {};
  const r: HoursRecord = {};
  for (const d of DAYS) {
    const v = (ho as Record<string, unknown>)[d];
    if (typeof v === "string") r[d] = v;
  }
  return r;
}

function SubcategoryCustomField({ onAdd }: { onAdd: (text: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <TextInput
      style={[styles.input, styles.subCustomInput]}
      value={val}
      onChangeText={setVal}
      onSubmitEditing={() => {
        const t = val.trim();
        if (t) {
          onAdd(t);
          setVal("");
        }
      }}
      placeholder="Add custom subcategory (Enter)"
      placeholderTextColor={theme.colors.placeholder}
      returnKeyType="done"
    />
  );
}

export interface BusinessFormData {
  id?: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
  address: string | null;
  city: string | null;
  categories: string[];
  subcategoriesByPrimary?: Record<string, string[]>;
  photos: string[];
  hoursOfOperation: HoursRecord | null;
}

interface BusinessFormProps {
  existing?: BusinessFormData | null;
  onSuccess: () => void;
  onDelete?: () => void;
  /** When provided, form acts as draft: collects data and calls this instead of API. Logo is optional. Can be async. */
  onDraftSubmit?: (data: Record<string, unknown>) => void | Promise<void>;
  /** Custom button text when onDraftSubmit is used (default: "Complete registration") */
  draftButtonLabel?: string;
  /** Content rendered at the top of the scroll area, before the form fields */
  headerContent?: React.ReactNode;
}

export function BusinessForm({ existing, onSuccess, onDelete, onDraftSubmit, draftButtonLabel, headerContent }: BusinessFormProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [shortDescription, setShortDescription] = useState(
    existing?.shortDescription ?? ""
  );
  const [fullDescription, setFullDescription] = useState(
    existing?.fullDescription ?? ""
  );
  const [website, setWebsite] = useState(existing?.website ?? "");
  const [phone, setPhone] = useState(existing?.phone ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [logoUrl, setLogoUrl] = useState(existing?.logoUrl ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const existingCity = existing?.city ?? "";
  const isPrebuiltCity = existingCity && PREBUILT_CITIES.includes(existingCity as (typeof PREBUILT_CITIES)[number]);
  const [city, setCity] = useState(isPrebuiltCity ? existingCity : (existingCity ? "Other" : ""));
  const [customCity, setCustomCity] = useState(!isPrebuiltCity ? existingCity : "");
  const [categories, setCategories] = useState<string[]>(() => {
    const cats = existing?.categories ?? [];
    if (cats.length === 0) return [""];
    if (cats.length === 1) return [cats[0], ""];
    return cats.slice(0, 2);
  });
  const [subsPerSlot, setSubsPerSlot] = useState<string[][]>(() => {
    const map = parseSubcategoriesByPrimary(existing?.subcategoriesByPrimary);
    const cats = existing?.categories ?? [];
    const p0 = (cats[0] ?? "").trim();
    const p1 = (cats[1] ?? "").trim();
    return [
      p0 ? [...(map[p0] ?? [])] : [],
      p1 ? [...(map[p1] ?? [])] : [],
    ];
  });
  const primaryCommittedRef = useRef<[string, string]>(["", ""]);
  useEffect(() => {
    const c = existing?.categories ?? [];
    primaryCommittedRef.current = [(c[0] ?? "").trim(), (c[1] ?? "").trim()];
  }, [existing?.id]);

  function toggleSubSlot(slotIdx: number, sub: string) {
    const t = sub.trim();
    if (!t) return;
    setSubsPerSlot((prev) => {
      const next = prev.map((arr) => [...arr]);
      const list = next[slotIdx] ?? [];
      const j = list.indexOf(t);
      if (j >= 0) next[slotIdx] = list.filter((_, k) => k !== j);
      else next[slotIdx] = [...list, t];
      return next;
    });
  }

  function addCustomSubSlot(slotIdx: number, raw: string) {
    const t = raw.trim();
    if (!t) return;
    setSubsPerSlot((prev) => {
      const next = prev.map((arr) => [...arr]);
      const list = next[slotIdx] ?? [];
      if (!list.includes(t)) next[slotIdx] = [...list, t];
      return next;
    });
  }
  const [photos, setPhotos] = useState<string[]>(
    () => (existing?.photos ?? []).slice(0, MAX_BUSINESS_GALLERY_PHOTOS)
  );
  const [hours, setHours] = useState<HoursRecord>(() =>
    parseHours(existing?.hoursOfOperation ?? null)
  );
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [uploadPhotoProgress, setUploadPhotoProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [categoryPresets, setCategoryPresets] = useState<CategoryPreset[]>([]);
  const galleryUploadSessionRef = useRef(Promise.resolve());

  useEffect(() => {
    apiGet<{ categories?: CategoryPreset[] }>("/api/business-categories")
      .then((d) => setCategoryPresets(Array.isArray(d.categories) ? d.categories : []))
      .catch(() => setCategoryPresets([]));
  }, []);

  const pickLogo = async () => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (asset.fileSize != null && asset.fileSize > MAX_UPLOAD_FILE_BYTES) {
      setError(`Image is too large (max ${formatMaxUploadSizeLabel()}).`);
      return;
    }
    setUploadingLogo(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in to upload photos.");
        return;
      }
      const prepared = await prepareBusinessImage(asset.uri);
      const formData = new FormData();
      formData.append("file", {
        uri: prepared.uri,
        type: prepared.type,
        name: "logo.jpg",
      } as unknown as Blob);
      const signupHeaders = onDraftSubmit ? { "x-signup-flow": "true" } : undefined;
      const { url } = await apiUploadFile("/api/upload", formData, signupHeaders);
      setLogoUrl(toFullUrl(url));
    } catch (e) {
      const err = e as { error?: string; status?: number };
      setError(uploadErrorMessage(e, "Logo upload failed. Try again.", !!onDraftSubmit, err.status));
    } finally {
      setUploadingLogo(false);
    }
  };

  const pickPhotos = async () => {
    const remaining = MAX_BUSINESS_GALLERY_PHOTOS - photos.length;
    if (remaining <= 0) {
      Alert.alert(
        "Gallery limit",
        `You can add up to ${MAX_BUSINESS_GALLERY_PHOTOS} gallery photos. Remove one to add another.`
      );
      return;
    }
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: remaining,
    });
    if (result.canceled) return;
    const assets = result.assets.slice(0, remaining);
    const session = (async () => {
      setUploadingPhotos(true);
      setUploadPhotoProgress({ done: 0, total: assets.length });
      setError("");
      const token = await getToken();
      if (!token) {
        setUploadingPhotos(false);
        setUploadPhotoProgress(null);
        setError("Sign in to upload photos.");
        return;
      }
      let added = 0;
      const errMsgs: string[] = [];
      const signupHeaders = onDraftSubmit ? { "x-signup-flow": "true" } : undefined;
      const CONCURRENCY = 4;

      const uploadOne = async (asset: (typeof assets)[0]) => {
        if (asset.fileSize != null && asset.fileSize > MAX_UPLOAD_FILE_BYTES) {
          errMsgs.push(`A photo exceeds ${formatMaxUploadSizeLabel()}.`);
          return;
        }
        try {
          const prepared = await prepareBusinessImage(asset.uri);
          const formData = new FormData();
          formData.append("file", {
            uri: prepared.uri,
            type: prepared.type,
            name: "photo.jpg",
          } as unknown as Blob);
          const { url } = await apiUploadFile("/api/upload", formData, signupHeaders);
          const fullUrl = toFullUrl(url);
          setPhotos((p) => {
            if (p.length >= MAX_BUSINESS_GALLERY_PHOTOS) return p;
            if (p.includes(fullUrl)) return p;
            return [...p, fullUrl];
          });
          added += 1;
        } catch (e) {
          const err = e as { error?: string; status?: number };
          errMsgs.push(uploadErrorMessage(e, "Photo upload failed.", !!onDraftSubmit, err.status));
        } finally {
          setUploadPhotoProgress((prev) =>
            prev ? { ...prev, done: Math.min(prev.done + 1, prev.total) } : null
          );
        }
      };

      try {
        for (let start = 0; start < assets.length; start += CONCURRENCY) {
          const chunk = assets.slice(start, start + CONCURRENCY);
          await Promise.all(chunk.map((a) => uploadOne(a)));
        }
        const distinct = [...new Set(errMsgs.filter(Boolean))];
        const summary = distinct.join(" ");
        if (added < assets.length && summary) {
          setError(
            added > 0
              ? `Uploaded ${added} of ${assets.length}. ${summary}`
              : summary
          );
        } else if (added === 0 && assets.length > 0 && summary) {
          setError(summary);
        }
      } finally {
        setUploadingPhotos(false);
        setUploadPhotoProgress(null);
      }
    })();
    galleryUploadSessionRef.current = galleryUploadSessionRef.current.then(() => session);
  };

  const removePhoto = (i: number) => {
    setPhotos((p) => p.filter((_, idx) => idx !== i));
  };

  const normalizeWebsite = (val: string): string => {
    const trimmed = val.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    return `https://${trimmed}`;
  };

  const handleSubmit = async () => {
    const cats = categories.filter((c) => c.trim()).slice(0, 2);
    if (cats.length === 0) {
      setError("At least one category is required.");
      return;
    }
    const effectiveCity = city === "Other" ? customCity.trim() : city.trim();
    if (!effectiveCity) {
      setError("City is required.");
      return;
    }
    if (!onDraftSubmit && !existing && !logoUrl.trim()) {
      setError("Logo is required.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      if (onDraftSubmit) {
        await galleryUploadSessionRef.current.catch(() => {});
      }
      const map: Record<string, string[]> = {};
      cats.forEach((c, i) => {
        const list = (subsPerSlot[i] ?? []).map((s) => s.trim()).filter(Boolean);
        if (list.length) map[c] = [...new Set(list)];
      });
      const payload = {
        name: name.trim(),
        shortDescription: shortDescription.trim() || null,
        fullDescription: fullDescription.trim() || null,
        website: website.trim() ? normalizeWebsite(website) : null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        logoUrl: logoUrl.trim() || null,
        address: address.trim() || null,
        city: (city === "Other" ? customCity.trim() : city.trim()) || null,
        categories: cats,
        subcategoriesByPrimary: normalizeSubcategoriesByPrimary(cats, map),
        photos: photos.slice(0, MAX_BUSINESS_GALLERY_PHOTOS),
        hoursOfOperation: (() => {
          const filtered = Object.fromEntries(
            Object.entries(hours).filter(
              ([, v]) => typeof v === "string" && v.trim() !== ""
            )
          );
          return Object.keys(filtered).length ? filtered : null;
        })(),
      };

      if (onDraftSubmit) {
        await onDraftSubmit(payload);
      } else if (existing?.id) {
        await apiPatch(`/api/businesses/${existing.id}`, payload);
      } else {
        await apiPost("/api/businesses", payload);
      }
      if (!onDraftSubmit) onSuccess();
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Failed to save. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {headerContent}
        <View style={styles.field}>
          <Text style={styles.label}>Company name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Business name"
            placeholderTextColor={theme.colors.placeholder}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Brief description *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={shortDescription}
            onChangeText={setShortDescription}
            placeholder="Short tagline"
            placeholderTextColor={theme.colors.placeholder}
            multiline
            numberOfLines={2}
            autoCorrect={true}
            autoCapitalize="sentences"
            spellCheck={true}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Full description *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={fullDescription}
            onChangeText={setFullDescription}
            placeholder="Full description"
            placeholderTextColor={theme.colors.placeholder}
            multiline
            numberOfLines={4}
            autoCorrect={true}
            autoCapitalize="sentences"
            spellCheck={true}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Website (optional)</Text>
          <TextInput
            style={styles.input}
            value={website}
            onChangeText={setWebsite}
            onBlur={() => {
              if (website.trim()) setWebsite(normalizeWebsite(website));
            }}
            placeholder="example.com or https://..."
            placeholderTextColor={theme.colors.placeholder}
            keyboardType="url"
            autoCapitalize="none"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            placeholderTextColor={theme.colors.placeholder}
            keyboardType="phone-pad"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Email (optional)</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="contact@example.com"
            placeholderTextColor={theme.colors.placeholder}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Logo *</Text>
          {logoUrl ? (
            <View style={styles.logoRow}>
              <Image
                source={{ uri: logoUrl }}
                style={styles.logoPreview}
                contentFit="contain"
                cachePolicy="memory-disk"
              />
              <Pressable
                style={styles.removeLogoBtn}
                onPress={() => setLogoUrl("")}
              >
                <Text style={styles.removeLogoText}>×</Text>
              </Pressable>
            </View>
          ) : null}
          <Pressable
            style={[
              styles.uploadBtn,
              uploadingLogo && styles.uploadBtnDisabled,
            ]}
            onPress={pickLogo}
            disabled={uploadingLogo}
          >
            <View style={styles.uploadBtnInner}>
              {uploadingLogo ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : null}
              <Text style={styles.uploadBtnText}>
                {uploadingLogo ? "Uploading…" : logoUrl ? "Change logo" : "Upload logo"}
              </Text>
            </View>
          </Pressable>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Address (optional)</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="e.g. 123 Main St, Coeur d'Alene, ID 83815"
            placeholderTextColor={theme.colors.placeholder}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>City *</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.pickerScroll}
            contentContainerStyle={styles.pickerRow}
          >
            {[...PREBUILT_CITIES, "Other"].map((c) => (
              <Pressable
                key={c}
                style={[
                  styles.pickerOption,
                  city === c && styles.pickerOptionSelected,
                ]}
                onPress={() => setCity(c)}
              >
                <Text
                  style={[
                    styles.pickerOptionText,
                    city === c && styles.pickerOptionTextSelected,
                  ]}
                  numberOfLines={1}
                >
                  {c}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          {city === "Other" && (
            <TextInput
              style={[styles.input, { marginTop: 8 }]}
              value={customCity}
              onChangeText={setCustomCity}
              placeholder="Enter your city"
              placeholderTextColor={theme.colors.placeholder}
            />
          )}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Business categories (up to 2) *</Text>
          <Text style={styles.hint}>
            Primary categories (from our list or custom). Tap multiple subs per primary or add your own.
          </Text>
          {[0, 1].map((i) => {
            const primaryTrim = (categories[i] ?? "").trim();
            const preset = primaryTrim ? getSubcategoriesForBusinessCategory(primaryTrim) : [];
            const selected = subsPerSlot[i] ?? [];
            return (
              <View
                key={i}
                style={[
                  styles.categorySlot,
                  i === 1 ? { marginTop: 12 } : undefined,
                ]}
              >
                <BusinessCategoryPrimaryPicker
                  value={categories[i] ?? ""}
                  onChange={(v) => {
                    const next = [...categories];
                    next[i] = v;
                    if (i === 0 && next.length === 1 && v.trim()) next.push("");
                    setCategories(next.slice(0, 2));
                    primaryCommittedRef.current[i] = v.trim();
                    setSubsPerSlot((sp) => {
                      const n = sp.map((a) => [...a]);
                      n[i] = [];
                      return n;
                    });
                  }}
                  shortDescription={shortDescription}
                  fullDescription={fullDescription}
                  presets={categoryPresets.length > 0 ? categoryPresets : BUSINESS_CATEGORIES}
                  required={i === 0}
                />
                {primaryTrim ? (
                  <View style={{ marginTop: 8 }}>
                    {preset.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.subChipScroll}
                        contentContainerStyle={styles.subChipRow}
                      >
                        {preset.map((s) => {
                          const on = selected.includes(s);
                          return (
                            <Pressable
                              key={s}
                              style={[styles.subChip, on && styles.subChipSelected]}
                              onPress={() => toggleSubSlot(i, s)}
                            >
                              <Text style={[styles.subChipText, on && styles.subChipTextSelected]}>{s}</Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    ) : null}
                    <SubcategoryCustomField
                      key={`${i}-${primaryTrim}`}
                      onAdd={(text) => addCustomSubSlot(i, text)}
                    />
                    {selected.length > 0 ? (
                      <Text style={styles.selectedSubs}>
                        Selected: {selected.join(", ")}
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Hours of operation</Text>
          <Text style={styles.hint}>
            e.g. 9:00 AM - 5:00 PM or CLOSED
          </Text>
          {DAYS.map((day) => (
            <View key={day} style={styles.hoursRow}>
              <Text style={styles.hoursLabel}>{day}</Text>
              <TextInput
                style={[styles.input, styles.hoursInput]}
                value={hours[day] ?? ""}
                onChangeText={(v) =>
                  setHours((h) => ({ ...h, [day]: v }))
                }
                placeholder="9:00 AM - 5:00 PM"
                placeholderTextColor={theme.colors.placeholder}
              />
            </View>
          ))}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Photos for Gallery (Recommended)</Text>
          <Text style={styles.hint}>
            Up to {MAX_BUSINESS_GALLERY_PHOTOS} photos, {formatMaxUploadSizeLabel()} each (JPEG, PNG, WebP, GIF).
            Images are resized for faster upload. You can tap Continue during signup; we finish any in-progress uploads
            before moving on.
          </Text>
          {uploadingPhotos && uploadPhotoProgress ? (
            <Text style={styles.uploadProgressBanner}>
              Uploading gallery photos: {uploadPhotoProgress.done}/{uploadPhotoProgress.total} complete…
            </Text>
          ) : null}
          <Pressable
            style={[
              styles.uploadBtn,
              uploadingPhotos && styles.uploadBtnDisabled,
            ]}
            onPress={pickPhotos}
            disabled={uploadingPhotos}
          >
            <View style={styles.uploadBtnInner}>
              {uploadingPhotos ? (
                <ActivityIndicator size="small" color={GALLERY_UPLOAD_SPINNER} />
              ) : null}
              <Text style={styles.uploadBtnText}>
                {uploadingPhotos && uploadPhotoProgress
                  ? `Uploading ${uploadPhotoProgress.done}/${uploadPhotoProgress.total}…`
                  : uploadingPhotos
                    ? "Uploading…"
                    : "Upload photos"}
              </Text>
            </View>
          </Pressable>
          {photos.length > 0 && (
            <View style={styles.photosRow}>
              {photos.map((url, i) => (
                <View key={`${i}-${url}`} style={styles.photoWrap}>
                  <Image
                    source={{ uri: url }}
                    style={styles.photo}
                    contentFit="cover"
                    cachePolicy="none"
                    recyclingKey={`g-${i}-${url}`}
                  />
                  <Pressable
                    style={styles.removePhotoBtn}
                    onPress={() => removePhoto(i)}
                  >
                    <Text style={styles.removePhotoText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={[
            styles.submitBtn,
            (submitting || uploadingLogo || (!onDraftSubmit && uploadingPhotos)) && styles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={submitting || uploadingLogo || (!onDraftSubmit && uploadingPhotos)}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : uploadingLogo || (!onDraftSubmit && uploadingPhotos) ? (
            <View style={styles.uploadingRow}>
              <ActivityIndicator color={GALLERY_UPLOAD_SPINNER} size="small" />
              <Text style={styles.submitBtnText}>Uploading photos…</Text>
            </View>
          ) : (
            <Text style={styles.submitBtnText}>
              {onDraftSubmit ? (draftButtonLabel ?? "Complete registration") : existing ? "Update business" : "Add business"}
            </Text>
          )}
        </Pressable>
        {existing && onDelete ? (
          <Pressable
            style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.8 }]}
            onPress={onDelete}
            disabled={submitting}
          >
            <Text style={styles.deleteBtnText}>Delete business</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  field: { marginBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 6,
  },
  hint: { fontSize: 12, color: "#666", marginBottom: 8 },
  uploadProgressBanner: {
    fontSize: 13,
    fontWeight: "600",
    color: GALLERY_UPLOAD_SPINNER,
    marginBottom: 8,
  },
  categorySlot: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    padding: 10,
    backgroundColor: "#fafafa",
  },
  subChipScroll: { marginTop: 4 },
  subChipRow: { flexDirection: "row", gap: 8, paddingVertical: 4 },
  subChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  subChipSelected: { backgroundColor: theme.colors.primary },
  subChipText: { fontSize: 12, color: theme.colors.heading },
  subChipTextSelected: { color: theme.colors.buttonText },
  subCustomInput: { marginTop: 8, backgroundColor: "#fff" },
  selectedSubs: { fontSize: 12, color: "#444", marginTop: 6 },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    color: theme.colors.text,
  },
  textArea: { minHeight: 60, textAlignVertical: "top" },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8 },
  logoPreview: { width: 80, height: 80, borderRadius: 6 },
  removeLogoBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#c00",
    alignItems: "center",
    justifyContent: "center",
  },
  removeLogoText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
  uploadBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  uploadBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  uploadBtnDisabled: { opacity: 0.6 },
  uploadBtnText: {
    fontSize: 16,
    color: theme.colors.primary,
    fontWeight: "600",
  },
  hoursRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  hoursLabel: {
    width: 90,
    fontSize: 13,
    color: theme.colors.text,
    textTransform: "capitalize",
  },
  hoursInput: { flex: 1 },
  photosRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  photoWrap: { position: "relative" },
  photo: { width: 64, height: 64, borderRadius: 6 },
  removePhotoBtn: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#c00",
    alignItems: "center",
    justifyContent: "center",
  },
  removePhotoText: { color: "#fff", fontSize: 16, fontWeight: "bold" },
  error: { color: "#c00", fontSize: 14, marginBottom: 12 },
  pickerScroll: { marginHorizontal: -4 },
  pickerRow: { flexDirection: "row", gap: 8, paddingHorizontal: 4, flexWrap: "wrap" },
  pickerOption: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  pickerOptionSelected: { backgroundColor: theme.colors.primary },
  pickerOptionText: { fontSize: 13, color: theme.colors.heading },
  pickerOptionTextSelected: { color: theme.colors.buttonText },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.7 },
  uploadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  submitBtnText: {
    color: theme.colors.buttonText,
    fontSize: 18,
    fontWeight: "600",
  },
  deleteBtn: {
    marginTop: 24,
    paddingVertical: 12,
    alignItems: "center",
  },
  deleteBtnText: {
    fontSize: 16,
    color: "#c00",
    fontWeight: "500",
  },
});
