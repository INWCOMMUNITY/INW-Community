import { useState } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { theme } from "@/lib/theme";
import { apiPost, apiPatch, apiUploadFile, getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
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

function parseHours(ho: unknown): HoursRecord {
  if (!ho || typeof ho !== "object") return {};
  const r: HoursRecord = {};
  for (const d of DAYS) {
    const v = (ho as Record<string, unknown>)[d];
    if (typeof v === "string") r[d] = v;
  }
  return r;
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
}

export function BusinessForm({ existing, onSuccess, onDelete, onDraftSubmit, draftButtonLabel }: BusinessFormProps) {
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
  const [city, setCity] = useState(existing?.city ?? "");
  const [categories, setCategories] = useState<string[]>(() => {
    const cats = existing?.categories ?? [];
    if (cats.length === 0) return [""];
    if (cats.length === 1) return [cats[0], ""];
    return cats.slice(0, 2);
  });
  const [photos, setPhotos] = useState<string[]>(existing?.photos ?? []);
  const [hours, setHours] = useState<HoursRecord>(() =>
    parseHours(existing?.hoursOfOperation ?? null)
  );
  const [submitting, setSubmitting] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [error, setError] = useState("");

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
    setUploadingLogo(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in to upload photos.");
        return;
      }
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: "logo.jpg",
      } as unknown as Blob);
      const { url } = await apiUploadFile("/api/upload", formData);
      setLogoUrl(toFullUrl(url));
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Logo upload failed. Try again."
      );
    } finally {
      setUploadingLogo(false);
    }
  };

  const pickPhotos = async () => {
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
    });
    if (result.canceled) return;
    setUploadingPhotos(true);
    setError("");
    try {
      const token = await getToken();
      if (!token) {
        setError("Sign in to upload photos.");
        return;
      }
      for (const asset of result.assets) {
        const formData = new FormData();
        formData.append("file", {
          uri: asset.uri,
          type: asset.mimeType ?? "image/jpeg",
          name: "photo.jpg",
        } as unknown as Blob);
        const { url } = await apiUploadFile("/api/upload", formData);
        const fullUrl = toFullUrl(url);
        setPhotos((p) => (p.includes(fullUrl) ? p : [...p, fullUrl]));
      }
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Photo upload failed. Try again."
      );
    } finally {
      setUploadingPhotos(false);
    }
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
    if (!onDraftSubmit && !existing && !logoUrl.trim()) {
      setError("Logo is required.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const payload = {
        name: name.trim(),
        shortDescription: shortDescription.trim() || null,
        fullDescription: fullDescription.trim() || null,
        website: website.trim() ? normalizeWebsite(website) : null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        logoUrl: logoUrl.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        categories: cats,
        photos,
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
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
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
                resizeMode="contain"
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
            <Text style={styles.uploadBtnText}>
              {uploadingLogo ? "Uploading…" : logoUrl ? "Change logo" : "Upload logo"}
            </Text>
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
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={setCity}
            placeholder="e.g. Coeur d'Alene"
            placeholderTextColor={theme.colors.placeholder}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Business categories (up to 2) *</Text>
          {[0, 1].map((i) => (
            <TextInput
              key={i}
              style={[styles.input, i === 1 && { marginTop: 8 }]}
              value={categories[i] ?? ""}
              onChangeText={(v) => {
                const next = [...categories];
                next[i] = v;
                if (i === 0 && next.length === 1 && v) next.push("");
                setCategories(next.slice(0, 2));
              }}
              placeholder={i === 0 ? "e.g. Retail" : "e.g. Marketing (optional)"}
              placeholderTextColor={theme.colors.placeholder}
            />
          ))}
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
          <Pressable
            style={[
              styles.uploadBtn,
              uploadingPhotos && styles.uploadBtnDisabled,
            ]}
            onPress={pickPhotos}
            disabled={uploadingPhotos}
          >
            <Text style={styles.uploadBtnText}>
              {uploadingPhotos ? "Uploading…" : "Upload photos"}
            </Text>
          </Pressable>
          {photos.length > 0 && (
            <View style={styles.photosRow}>
              {photos.map((url, i) => (
                <View key={url} style={styles.photoWrap}>
                  <Image
                    source={{ uri: url }}
                    style={styles.photo}
                    resizeMode="cover"
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
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
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
  scroll: { flex: 1, backgroundColor: "#fff" },
  scrollContent: { padding: 16, paddingBottom: 40, backgroundColor: "#fff" },
  field: { marginBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 6,
  },
  hint: { fontSize: 12, color: "#666", marginBottom: 8 },
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
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.7 },
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
