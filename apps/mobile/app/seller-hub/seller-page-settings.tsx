import { useEffect, useState, useCallback } from "react";
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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiUploadFile } from "@/lib/api";
import { AppImage } from "@/components/AppImage";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const DAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

interface BusinessData {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  fullDescription: string | null;
  coverPhotoUrl: string | null;
  photos: string[];
  hoursOfOperation: Record<string, string> | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function SellerPageSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [businessId, setBusinessId] = useState<string | null>(null);

  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [shortDescription, setShortDescription] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [hours, setHours] = useState<Record<string, string>>({});

  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const businesses = await apiGet<{ id: string }[]>("/api/businesses?mine=1");
      if (!Array.isArray(businesses) || businesses.length === 0) {
        setError("No business found. Please set up your business first.");
        setLoading(false);
        return;
      }
      const id = businesses[0].id;
      setBusinessId(id);

      const data = await apiGet<BusinessData>(`/api/businesses/${id}`);
      setCoverPhotoUrl(data.coverPhotoUrl ?? null);
      setPhotos(data.photos ?? []);
      setShortDescription(data.shortDescription ?? "");
      setFullDescription(data.fullDescription ?? "");
      setFacebookUrl(data.facebookUrl ?? "");
      setInstagramUrl(data.instagramUrl ?? "");
      setTiktokUrl(data.tiktokUrl ?? "");
      setHours(data.hoursOfOperation ?? {});
    } catch (e) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pickCoverPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to upload a cover photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (result.canceled) return;

    setUploadingCover(true);
    try {
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: "cover.jpg",
      } as unknown as Blob);
      const { url } = await apiUploadFile("/api/upload/business", formData);
      const fullUrl = url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
      setCoverPhotoUrl(fullUrl);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Upload failed", err?.error ?? "Failed to upload cover photo.");
    } finally {
      setUploadingCover(false);
    }
  };

  const pickGalleryPhotos = async () => {
    if (photos.length >= 12) {
      Alert.alert("Limit reached", "Maximum 12 gallery photos allowed.");
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to upload gallery images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: 12 - photos.length,
      quality: 0.8,
    });
    if (result.canceled) return;

    setUploadingGallery(true);
    try {
      const newUrls: string[] = [];
      for (const asset of result.assets) {
        const formData = new FormData();
        formData.append("file", {
          uri: asset.uri,
          type: asset.mimeType ?? "image/jpeg",
          name: "gallery.jpg",
        } as unknown as Blob);
        const { url } = await apiUploadFile("/api/upload/business", formData);
        const fullUrl = url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
        newUrls.push(fullUrl);
      }
      setPhotos((prev) => [...prev, ...newUrls].slice(0, 12));
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Upload failed", err?.error ?? "Failed to upload gallery photos.");
    } finally {
      setUploadingGallery(false);
    }
  };

  const removeGalleryPhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (!businessId) return;
    setError("");
    setSaving(true);
    setSaved(false);

    try {
      const hoursToSave = Object.keys(hours).length > 0 ? hours : null;
      await apiPatch(`/api/businesses/${businessId}`, {
        coverPhotoUrl: coverPhotoUrl || null,
        photos,
        shortDescription: shortDescription.trim() || null,
        fullDescription: fullDescription.trim() || null,
        facebookUrl: facebookUrl.trim() || null,
        instagramUrl: instagramUrl.trim() || null,
        tiktokUrl: tiktokUrl.trim() || null,
        hoursOfOperation: hoursToSave,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      const err = e as { error?: string };
      setError(err?.error ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error && !businessId) {
    return (
      <View style={[styles.center, { padding: 24 }]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Seller Page Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Customize your seller page to attract more buyers. Add a cover photo, gallery, hours, and social links.
        </Text>

        {/* Cover Photo */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cover Photo</Text>
          <Text style={styles.sectionHint}>Recommended: 16:9 aspect ratio (e.g., 1920×1080)</Text>
          <Pressable style={styles.coverPicker} onPress={pickCoverPhoto} disabled={uploadingCover}>
            {uploadingCover ? (
              <ActivityIndicator size="large" color={theme.colors.primary} />
            ) : coverPhotoUrl ? (
              <AppImage uri={resolveUrl(coverPhotoUrl) ?? ""} targetWidth={400} style={styles.coverPreview} resizeMode="cover" />
            ) : (
              <View style={styles.coverPlaceholder}>
                <Ionicons name="image-outline" size={48} color="#999" />
                <Text style={styles.placeholderText}>Tap to add cover photo</Text>
              </View>
            )}
          </Pressable>
          {coverPhotoUrl && (
            <Pressable style={styles.removeBtn} onPress={() => setCoverPhotoUrl(null)}>
              <Text style={styles.removeBtnText}>Remove cover photo</Text>
            </Pressable>
          )}
        </View>

        {/* Gallery Photos */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Gallery Photos</Text>
          <Text style={styles.sectionHint}>Up to 12 photos to showcase your work</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.galleryScroll}>
            {photos.map((uri, index) => (
              <View key={`${index}-${uri}`} style={styles.galleryItem}>
                <AppImage uri={resolveUrl(uri) ?? ""} targetWidth={100} style={styles.galleryImage} resizeMode="cover" />
                <Pressable style={styles.galleryRemove} onPress={() => removeGalleryPhoto(index)}>
                  <Ionicons name="close-circle" size={24} color="#c00" />
                </Pressable>
              </View>
            ))}
            {photos.length < 12 && (
              <Pressable style={styles.galleryAddBtn} onPress={pickGalleryPhotos} disabled={uploadingGallery}>
                {uploadingGallery ? (
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                ) : (
                  <>
                    <Ionicons name="add" size={32} color={theme.colors.primary} />
                    <Text style={styles.galleryAddText}>Add</Text>
                  </>
                )}
              </Pressable>
            )}
          </ScrollView>
        </View>

        {/* Short Description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Short Description</Text>
          <Text style={styles.sectionHint}>A brief tagline for your seller page (shown prominently)</Text>
          <TextInput
            style={styles.input}
            value={shortDescription}
            onChangeText={setShortDescription}
            placeholder="e.g., Handmade jewelry and vintage finds"
            placeholderTextColor={theme.colors.placeholder}
            maxLength={150}
          />
          <Text style={styles.charCount}>{shortDescription.length}/150</Text>
        </View>

        {/* Full Description */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Full Description</Text>
          <Text style={styles.sectionHint}>Tell buyers more about you and what you sell</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            value={fullDescription}
            onChangeText={setFullDescription}
            placeholder="Share your story, what you sell, and why buyers should choose you..."
            placeholderTextColor={theme.colors.placeholder}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </View>

        {/* Social Media */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Social Media Links</Text>
          <Text style={styles.sectionHint}>Connect with your audience across platforms</Text>
          
          <View style={styles.socialInput}>
            <Ionicons name="logo-facebook" size={22} color="#1877F2" style={styles.socialIcon} />
            <TextInput
              style={styles.socialField}
              value={facebookUrl}
              onChangeText={setFacebookUrl}
              placeholder="https://facebook.com/yourpage"
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>

          <View style={styles.socialInput}>
            <Ionicons name="logo-instagram" size={22} color="#E4405F" style={styles.socialIcon} />
            <TextInput
              style={styles.socialField}
              value={instagramUrl}
              onChangeText={setInstagramUrl}
              placeholder="https://instagram.com/yourhandle"
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>

          <View style={styles.socialInput}>
            <Ionicons name="logo-tiktok" size={22} color="#000" style={styles.socialIcon} />
            <TextInput
              style={styles.socialField}
              value={tiktokUrl}
              onChangeText={setTiktokUrl}
              placeholder="https://tiktok.com/@yourhandle"
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="none"
              keyboardType="url"
            />
          </View>
        </View>

        {/* Hours of Operation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Hours of Operation</Text>
          <Text style={styles.sectionHint}>Let buyers know when you're available</Text>
          
          {DAY_ORDER.map((day) => (
            <View key={day} style={styles.hoursRow}>
              <Text style={styles.hoursDay}>{DAY_LABELS[day]}</Text>
              <TextInput
                style={styles.hoursInput}
                value={hours[day] ?? ""}
                onChangeText={(t) => setHours((prev) => ({ ...prev, [day]: t }))}
                placeholder="e.g., 9am - 5pm or Closed"
                placeholderTextColor={theme.colors.placeholder}
              />
            </View>
          ))}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.saveBtn,
            (saving || pressed) && styles.saveBtnDisabled,
          ]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>{saved ? "Saved!" : "Save Changes"}</Text>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
  },
  headerBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
  },
  headerSpacer: { width: 40 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  intro: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 24,
    lineHeight: 20,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  sectionHint: {
    fontSize: 13,
    color: "#888",
    marginBottom: 12,
  },
  coverPicker: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderStyle: "dashed",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f9f9f9",
  },
  coverPreview: {
    width: "100%",
    height: "100%",
  },
  coverPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderText: {
    marginTop: 8,
    fontSize: 14,
    color: "#888",
  },
  removeBtn: {
    marginTop: 8,
    alignSelf: "flex-start",
  },
  removeBtnText: {
    fontSize: 14,
    color: "#c00",
    fontWeight: "500",
  },
  galleryScroll: {
    marginHorizontal: -4,
  },
  galleryItem: {
    marginHorizontal: 4,
    position: "relative",
  },
  galleryImage: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  galleryRemove: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: "#fff",
    borderRadius: 12,
  },
  galleryAddBtn: {
    width: 100,
    height: 100,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 4,
    backgroundColor: "#f9f9f9",
  },
  galleryAddText: {
    fontSize: 12,
    color: theme.colors.primary,
    marginTop: 4,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: theme.colors.text,
  },
  multilineInput: {
    minHeight: 120,
    textAlignVertical: "top",
  },
  charCount: {
    fontSize: 12,
    color: "#888",
    textAlign: "right",
    marginTop: 4,
  },
  socialInput: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    marginBottom: 10,
    paddingLeft: 12,
  },
  socialIcon: {
    marginRight: 8,
  },
  socialField: {
    flex: 1,
    padding: 12,
    paddingLeft: 0,
    fontSize: 15,
    color: theme.colors.text,
  },
  hoursRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  hoursDay: {
    width: 100,
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: "500",
  },
  hoursInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    padding: 10,
    fontSize: 14,
    color: theme.colors.text,
  },
  error: {
    fontSize: 14,
    color: "#c00",
    marginBottom: 16,
  },
  errorText: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
    marginBottom: 16,
  },
  backButton: {
    padding: 12,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  backButtonText: {
    color: "#fff",
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    alignItems: "center",
    borderRadius: 8,
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
