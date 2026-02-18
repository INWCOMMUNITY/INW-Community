import { useState, useEffect } from "react";
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
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiUploadFile, getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface SellerProfile {
  member: { firstName: string; lastName: string; email: string } | null;
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
  packingSlipNote?: string | null;
}

export default function EditSellerProfileScreen() {
  const router = useRouter();
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
  const [packingSlipNote, setPackingSlipNote] = useState("");

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
        }
        if (data && "packingSlipNote" in data) {
          setPackingSlipNote((data as SellerProfile).packingSlipNote ?? "");
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
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploadingLogo(true);
    setError("");
    try {
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

  const handleSave = async () => {
    setError("");
    setSaving(true);
    try {
      await apiPatch("/api/seller-profile", {
        business: {
          name: name.trim() || "My Store",
          phone: phone.trim() || null,
          email: email.trim() || null,
          fullDescription: fullDescription.trim() || null,
          website: website.trim() || null,
          address: address.trim() || null,
          logoUrl: logoUrl.trim() || null,
          coverPhotoUrl: coverPhotoUrl.trim() || null,
        },
        packingSlipNote: packingSlipNote.trim() || null,
      });
      router.back();
    } catch (e) {
      setError((e as { error?: string }).error ?? "Failed to save");
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

  const inputStyle = [styles.input, { borderColor: "#ccc" }];
  const labelStyle = styles.label;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.heading} />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Seller Profile</Text>
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={[styles.saveBtn, saving && styles.disabled]}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </Pressable>
      </View>

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
          />

          <Text style={labelStyle}>Company Phone</Text>
          <TextInput
            style={inputStyle}
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
          />

          <Text style={labelStyle}>Contact Email</Text>
          <TextInput
            style={inputStyle}
            value={email}
            onChangeText={setEmail}
            placeholder="store@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={labelStyle}>Store Description</Text>
          <TextInput
            style={[inputStyle, styles.textArea]}
            value={fullDescription}
            onChangeText={setFullDescription}
            placeholder="Describe your store..."
            multiline
            numberOfLines={4}
          />

          <Text style={labelStyle}>Website</Text>
          <TextInput
            style={inputStyle}
            value={website}
            onChangeText={setWebsite}
            placeholder="https://"
            keyboardType="url"
            autoCapitalize="none"
          />

          <Text style={labelStyle}>Storefront Address</Text>
          <TextInput
            style={inputStyle}
            value={address}
            onChangeText={setAddress}
            placeholder="123 Main St, City, State"
          />
        </View>

<View style={styles.section}>
          <Text style={styles.sectionTitle}>Packing Slip Note</Text>
          <Text style={labelStyle}>Custom message on printed packing slips (optional)</Text>
          <TextInput
            style={[inputStyle, styles.textArea]}
            value={packingSlipNote}
            onChangeText={setPackingSlipNote}
            placeholder="e.g. Thank you for your order!"
            multiline
            numberOfLines={2}
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    backgroundColor: "#fff",
  },
  backBtn: { padding: 8 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#333",
    textAlign: "center",
  },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  saveBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
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
});
