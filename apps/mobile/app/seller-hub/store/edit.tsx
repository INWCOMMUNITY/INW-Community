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
import { apiGet, apiPatch, apiUploadFile } from "@/lib/api";

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
      allowsEditing: true,
      aspect: [16, 9],
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

        <Text style={styles.lede}>
          Tap the cover or logo to swap photos. Shoppers see this at the top of your page.
        </Text>

        <View style={styles.heroCard}>
          <Pressable style={styles.cover} onPress={pickCover} disabled={uploadingCover}>
            {uploadingCover ? (
              <ActivityIndicator color={theme.colors.earth} />
            ) : coverPhotoUrl ? (
              <Image source={{ uri: coverPhotoUrl }} style={styles.coverImg} resizeMode="cover" />
            ) : (
              <View style={styles.coverEmpty}>
                <Ionicons name="camera-outline" size={32} color={theme.colors.earth} />
                <Text style={styles.coverEmptyText}>Tap to add a cover</Text>
                <Text style={styles.coverEmptyHint}>A booth, workshop, or favorite piece</Text>
              </View>
            )}
            {coverPhotoUrl ? (
              <View style={styles.coverBadge}>
                <Ionicons name="camera-outline" size={14} color="#fff" />
                <Text style={styles.coverBadgeText}>Change cover</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable style={styles.logoWrap} onPress={pickLogo} disabled={uploadingLogo}>
            {uploadingLogo ? (
              <View style={[styles.logo, styles.logoEmpty]}>
                <ActivityIndicator color={theme.colors.earth} />
              </View>
            ) : logoUrl ? (
              <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="cover" />
            ) : (
              <View style={[styles.logo, styles.logoEmpty]}>
                <Ionicons name="add" size={28} color={theme.colors.earth} />
              </View>
            )}
          </Pressable>
          {logoUrl ? (
            <Pressable onPress={() => setLogoUrl("")} style={styles.removeLink}>
              <Text style={styles.removeLinkText}>Remove logo</Text>
            </Pressable>
          ) : (
            <Text style={styles.logoHint}>Tap the square for your logo</Text>
          )}
          {coverPhotoUrl ? (
            <Pressable onPress={() => setCoverPhotoUrl("")} style={styles.removeLink}>
              <Text style={styles.removeLinkText}>Remove cover</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>The story</Text>
          <Text style={styles.label}>Shop name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="My Store"
            autoCorrect={true}
          />
          <Text style={styles.label}>What you sell</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={fullDescription}
            onChangeText={setFullDescription}
            placeholder="Handmade soaps, vintage denim, farm eggs on Saturdays…"
            multiline
            numberOfLines={4}
            autoCorrect={true}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>How to find you</Text>
          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
            autoCorrect={true}
          />
          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="store@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={true}
          />
          <Text style={styles.label}>Website</Text>
          <TextInput
            style={styles.input}
            value={website}
            onChangeText={setWebsite}
            onBlur={() => setWebsite(normalizeWebsiteUrl(website))}
            placeholder="https://"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.label}>Storefront address</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="123 Main St, City, State"
            autoCorrect={true}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>How you sell</Text>
          <View style={styles.switchRow}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.switchLabel}>Take offers on Resale items</Text>
              <Text style={styles.switchHint}>
                Default for new resale listings. You can still change this per item.
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
          <View style={[styles.switchRow, styles.switchRowLast]}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={styles.switchLabel}>Allow Buyer Messages</Text>
              <Text style={styles.switchHint}>Shoppers can ask about a listing before they buy.</Text>
            </View>
            <Switch
              value={acceptMessagesForListings}
              onValueChange={setAcceptMessagesForListings}
              trackColor={switchTrackColor()}
              thumbColor={switchThumbColor(acceptMessagesForListings)}
              ios_backgroundColor={switchIosBackgroundColor}
            />
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.looksCard, pressed && { opacity: 0.85 }]}
          onPress={() => router.push("/seller-hub/seller-page-settings")}
        >
          <Ionicons name="images-outline" size={20} color={theme.colors.earth} />
          <Text style={styles.looksCardText}>Gallery, Hours & Social</Text>
          <Ionicons name="chevron-forward" size={18} color={theme.colors.earth} />
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.pageBackground },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: theme.colors.pageBackground,
  },
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
  lede: { fontSize: 14, color: theme.colors.text, lineHeight: 20, marginBottom: 14 },
  heroCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    overflow: "hidden",
    marginBottom: 12,
    alignItems: "center",
    paddingBottom: 12,
  },
  cover: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  coverImg: { width: "100%", height: "100%" },
  coverEmpty: { alignItems: "center", gap: 4 },
  coverEmptyText: { fontSize: 15, fontWeight: "700", color: theme.colors.earth },
  coverEmptyHint: { fontSize: 12, color: theme.colors.text },
  coverBadge: {
    position: "absolute",
    right: 10,
    bottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(93, 79, 64, 0.88)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  coverBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  logoWrap: {
    marginTop: -36,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: "#fff",
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  logo: { width: 72, height: 72 },
  logoEmpty: {
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  logoHint: { marginTop: 8, fontSize: 12, color: theme.colors.labelMuted },
  removeLink: { marginTop: 6 },
  removeLinkText: { fontSize: 13, fontWeight: "600", color: "#c00" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 16,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: theme.colors.labelMuted,
    marginBottom: 4,
  },
  label: { fontSize: 13, fontWeight: "600", color: theme.colors.heading, marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: "#e6e0d6",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: theme.colors.heading,
    backgroundColor: theme.colors.creamAlt,
  },
  textArea: { minHeight: 96, textAlignVertical: "top" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e6e0d6",
  },
  switchRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  switchLabel: { fontSize: 15, fontWeight: "600", color: theme.colors.heading },
  switchHint: { fontSize: 12, color: theme.colors.text, marginTop: 4, lineHeight: 18 },
  looksCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e0d6",
    padding: 14,
  },
  looksCardText: { flex: 1, fontSize: 15, fontWeight: "700", color: theme.colors.heading },
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
    borderColor: theme.colors.earth,
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
    backgroundColor: theme.colors.earth,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  savedBtnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
