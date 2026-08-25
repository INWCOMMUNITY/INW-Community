import { useState, useEffect, useLayoutEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Switch,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter, useNavigation } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { switchIosBackgroundColor, switchThumbColor, switchTrackColor, theme } from "@/lib/theme";
import { apiGet, apiPatch, apiUploadFile, getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed}`;
}

interface SellerProfile {
  member: { firstName: string; lastName: string; email: string; acceptOffersOnResale?: boolean; acceptMessagesForListings?: boolean } | null;
  business: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    fullDescription: string | null;
    website: string | null;
    address: string | null;
    city: string | null;
    logoUrl: string | null;
    coverPhotoUrl?: string | null;
    slug: string;
  } | null;
}

export default function EditSellerProfileScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [coverPhotoUrl, setCoverPhotoUrl] = useState("");
  const [acceptOffersOnResale, setAcceptOffersOnResale] = useState(true);
  const [acceptMessagesForListings, setAcceptMessagesForListings] = useState(true);
  const [savedOpen, setSavedOpen] = useState(false);
  const [sellerSlug, setSellerSlug] = useState("");

  useEffect(() => {
    apiGet<SellerProfile | { error: string }>("/api/seller-profile")
      .then((data) => {
        if (data && "business" in data && data.business) {
          const biz = data.business;
          setName(biz.name ?? "");
          setPhone(biz.phone ?? "");
          setEmail(biz.email ?? "");
          setFullDescription(biz.fullDescription ?? "");
          setWebsite(biz.website ?? "");
          setAddress(biz.address ?? "");
          setLogoUrl(biz.logoUrl ?? "");
          setCoverPhotoUrl((biz as { coverPhotoUrl?: string | null }).coverPhotoUrl ?? "");
          setSellerSlug(biz.slug ?? "");
        }
        if (data && "member" in data && data.member) {
          if (typeof data.member.acceptOffersOnResale === "boolean") {
            setAcceptOffersOnResale(data.member.acceptOffersOnResale);
          }
          if (typeof data.member.acceptMessagesForListings === "boolean") {
            setAcceptMessagesForListings(data.member.acceptMessagesForListings);
          }
        }
      })
      .catch(() => setError("Failed to load profile"))
      .finally(() => setLoading(false));
  }, []);

  const pickLogo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to change your logo.");
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
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append("purpose", "business-logo");
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: "logo.jpg",
      } as unknown as Blob);
      const { url } = await apiUploadFile("/api/upload", formData);
      setLogoUrl(toFullUrl(url));
    } catch (e) {
      setError((e as { error?: string }).error ?? "Upload failed");
    } finally {
      setUploadingLogo(false);
    }
  };

  const pickCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to change your cover.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploadingCover(true);
    setError("");
    try {
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: "cover.jpg",
      } as unknown as Blob);
      const { url } = await apiUploadFile("/api/upload", formData);
      setCoverPhotoUrl(toFullUrl(url));
    } catch (e) {
      setError((e as { error?: string }).error ?? "Upload failed");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSave = useCallback(async () => {
    setError("");
    setSaving(true);
    const websiteUrl = normalizeWebsiteUrl(website);
    setWebsite(websiteUrl);
    try {
      await apiPatch("/api/seller-profile", {
        acceptOffersOnResale,
        acceptMessagesForListings,
        business: {
          name: name.trim() || "My Store",
          phone: phone.trim() || null,
          email: email.trim() || null,
          fullDescription: fullDescription.trim() || null,
          website: websiteUrl || null,
          address: address.trim() || null,
          logoUrl: logoUrl.trim() || null,
          coverPhotoUrl: coverPhotoUrl.trim() || null,
        },
      });
      let slug = sellerSlug;
      if (!slug) {
        try {
          const refreshed = await apiGet<SellerProfile | { error: string }>("/api/seller-profile");
          if (refreshed && "business" in refreshed && refreshed.business?.slug) {
            slug = refreshed.business.slug;
          }
        } catch {
          slug = "";
        }
      }
      setSellerSlug(slug);
      setSavedOpen(true);
    } catch (e) {
      setError((e as { error?: string }).error ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [
    acceptOffersOnResale,
    acceptMessagesForListings,
    name,
    phone,
    email,
    fullDescription,
    website,
    address,
    logoUrl,
    coverPhotoUrl,
    sellerSlug,
  ]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => void handleSave()}
          disabled={saving}
          style={[styles.headerSaveBtn, saving && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Save seller profile"
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.headerSaveBtnText}>Save</Text>
          )}
        </Pressable>
      ),
    });
  }, [navigation, saving, handleSave]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  const inputStyle = [styles.input, { borderColor: "#ccc" }];
  const labelStyle = styles.label;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <Modal visible={savedOpen} transparent animationType="fade" statusBarTranslucent>
        <View style={styles.savedBackdrop}>
          <View style={styles.savedPanel}>
            <Text style={styles.savedTitle}>Your Seller Page has been saved.</Text>
            <Pressable
              style={({ pressed }) => [styles.savedBtn, pressed && { opacity: 0.85 }]}
              onPress={() => router.replace("/seller-hub")}
              accessibilityRole="button"
              accessibilityLabel="Return to Seller Hub"
            >
              <Text style={styles.savedBtnText}>Return to Seller Hub</Text>
            </Pressable>
            {sellerSlug ? (
              <Pressable
                style={({ pressed }) => [styles.savedBtn, pressed && { opacity: 0.85 }]}
                onPress={() => router.push(`/seller/${sellerSlug}` as never)}
                accessibilityRole="button"
                accessibilityLabel="See Seller Page"
              >
                <Text style={styles.savedBtnText}>See Seller Page</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </Modal>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Store Information</Text>

          <Text style={labelStyle}>Store Logo</Text>
          <View style={styles.logoRow}>
            {logoUrl ? (
              <Image source={{ uri: logoUrl }} style={styles.logoPreview} />
            ) : (
              <View style={[styles.logoPreview, styles.logoPlaceholder]}>
                <Ionicons name="storefront" size={32} color="#999" />
              </View>
            )}
            <Pressable
              onPress={pickLogo}
              disabled={uploadingLogo}
              style={[styles.uploadBtn, uploadingLogo && styles.disabled]}
            >
              <Text style={styles.uploadBtnText}>
                {uploadingLogo ? "Uploading…" : logoUrl ? "Change" : "Add"}
              </Text>
            </Pressable>
            {logoUrl ? (
              <Pressable onPress={() => setLogoUrl("")} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={labelStyle}>Cover Photo</Text>
          <View style={styles.logoRow}>
            {coverPhotoUrl ? (
              <Image source={{ uri: coverPhotoUrl }} style={styles.coverPreview} />
            ) : (
              <View style={[styles.coverPreview, styles.coverPlaceholder]}>
                <Ionicons name="image-outline" size={24} color="#999" />
              </View>
            )}
            <Pressable
              onPress={pickCover}
              disabled={uploadingCover}
              style={[styles.uploadBtn, uploadingCover && styles.disabled]}
            >
              <Text style={styles.uploadBtnText}>
                {uploadingCover ? "Uploading…" : coverPhotoUrl ? "Change" : "Add"}
              </Text>
            </Pressable>
            {coverPhotoUrl ? (
              <Pressable onPress={() => setCoverPhotoUrl("")} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={labelStyle}>Company Name</Text>
          <TextInput
            style={inputStyle}
            value={name}
            onChangeText={setName}
            placeholder="My Store"
            autoCorrect={true}
          />

          <Text style={labelStyle}>Company Phone</Text>
          <TextInput
            style={inputStyle}
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
            autoCorrect={true}
          />

          <Text style={labelStyle}>Contact Email</Text>
          <TextInput
            style={inputStyle}
            value={email}
            onChangeText={setEmail}
            placeholder="store@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={true}
          />

          <Text style={labelStyle}>Store Description</Text>
          <TextInput
            style={[inputStyle, styles.textArea]}
            value={fullDescription}
            onChangeText={setFullDescription}
            placeholder="Describe your store..."
            multiline
            numberOfLines={4}
            autoCorrect={true}
          />

          <Text style={labelStyle}>Website</Text>
          <TextInput
            style={inputStyle}
            value={website}
            onChangeText={setWebsite}
            onBlur={() => setWebsite(normalizeWebsiteUrl(website))}
            placeholder="https://"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={labelStyle}>Take offers on resale items</Text>
              <Text style={styles.switchHint}>
                Default for new resale listings. You can change this per item when listing.
              </Text>
            </View>
            <Switch
              value={acceptOffersOnResale}
              onValueChange={setAcceptOffersOnResale}
              trackColor={switchTrackColor()}
              thumbColor={switchThumbColor(acceptOffersOnResale)}
              ios_backgroundColor={switchIosBackgroundColor}
            />
          </View>

          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={labelStyle}>Allow buyers to message you</Text>
              <Text style={styles.switchHint}>
                When enabled, buyers can send you questions about your listings.
              </Text>
            </View>
            <Switch
              value={acceptMessagesForListings}
              onValueChange={setAcceptMessagesForListings}
              trackColor={switchTrackColor()}
              thumbColor={switchThumbColor(acceptMessagesForListings)}
              ios_backgroundColor={switchIosBackgroundColor}
            />
          </View>

          <Text style={labelStyle}>Storefront Address</Text>
          <TextInput
            style={inputStyle}
            value={address}
            onChangeText={setAddress}
            placeholder="123 Main St, City, State"
            autoCorrect={true}
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  headerSaveBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 4,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  headerSaveBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  disabled: { opacity: 0.6 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  errorText: { color: "#c00", marginBottom: 12, fontSize: 14 },
  section: {
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 8, color: theme.colors.heading },
  label: { fontSize: 13, color: "#666", marginBottom: 4, marginTop: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#333",
    backgroundColor: "#fff",
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  logoPreview: { width: 64, height: 64, borderRadius: 8 },
  logoPlaceholder: { backgroundColor: "#e0e0e0", justifyContent: "center", alignItems: "center" },
  coverPreview: { width: 120, height: 72, borderRadius: 8 },
  coverPlaceholder: { backgroundColor: "#e0e0e0", justifyContent: "center", alignItems: "center" },
  uploadBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  uploadBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  removeBtn: { padding: 8 },
  removeBtnText: { color: "#c00", fontSize: 14 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 8,
    paddingVertical: 8,
  },
  switchHint: { fontSize: 12, color: "#888", marginTop: 4, lineHeight: 18 },
  savedBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  savedPanel: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    padding: 24,
  },
  savedTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 20,
  },
  savedBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  savedBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
