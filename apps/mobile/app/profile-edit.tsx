import { useEffect, useState } from "react";
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
  Switch,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost, apiUploadFile, getToken } from "@/lib/api";
import { signOut } from "@/lib/auth";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function formatLoadError(e: unknown): string {
  const err = e as { error?: string };
  const msg = err?.error ?? "Failed to load profile.";
  const isNetwork =
    /unable to resolve|network request failed|failed to fetch|econnrefused|timed out/i.test(msg);
  return isNetwork
    ? typeof __DEV__ !== "undefined" && __DEV__
      ? `Cannot reach server (${msg}). Check: 1) Main site running (pnpm dev:main). 2) .env has EXPO_PUBLIC_API_URL=http://YOUR_IP:3000. 3) Phone and computer on same WiFi. 4) Restart Expo after changing .env.`
      : `Cannot reach server. Check your connection (Wi‑Fi or cellular) and try again.`
    : msg;
}

interface DeliveryAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface ProfileData {
  firstName: string;
  lastName: string;
  email: string;
  profilePhotoUrl: string | null;
  bio: string | null;
  city: string | null;
  phone: string | null;
  deliveryAddress?: DeliveryAddress | null;
  privacyLevel?: "public" | "friends_only" | "completely_private";
}

export default function ProfileEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [bio, setBio] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [shipStreet, setShipStreet] = useState("");
  const [shipCity, setShipCity] = useState("");
  const [shipState, setShipState] = useState("");
  const [shipZip, setShipZip] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [privacyLevel, setPrivacyLevel] = useState<"public" | "friends_only" | "completely_private">("public");

  useEffect(() => {
    getToken().then(async (token) => {
      if (!token) {
        setError("Please sign in to edit your profile.");
        setLoading(false);
        return;
      }
      try {
        const d = await apiGet<ProfileData>("/api/me");
        setFirstName(d.firstName ?? "");
        setLastName(d.lastName ?? "");
        setBio(d.bio ?? "");
        setCity(d.city ?? "");
        setPhone(d.phone ?? "");
        setProfilePhotoUrl(d.profilePhotoUrl ?? null);
        if (d.deliveryAddress) {
          setShipStreet(d.deliveryAddress.street ?? "");
          setShipCity(d.deliveryAddress.city ?? "");
          setShipState(d.deliveryAddress.state ?? "");
          setShipZip(d.deliveryAddress.zip ?? "");
        }
        if (d.privacyLevel) setPrivacyLevel(d.privacyLevel);
      } catch (e) {
        const err = e as { error?: string; status?: number };
        const msg = err?.error ?? "Failed to load profile.";
        setError(
          err?.status === 401
            ? "Your session expired. Please sign in again."
            : formatLoadError(e)
        );
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to change your profile picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploadingPhoto(true);
    setError("");
    try {
      const asset = result.assets[0];
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: "photo.jpg",
      } as unknown as Blob);
      const { url } = await apiUploadFile("/api/upload/profile", formData);
      const fullUrl = url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
      setProfilePhotoUrl(fullUrl);
    } catch (e) {
      setError((e as { error?: string }).error ?? "Photo upload failed. Try again.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    setError("");
    if (!firstName.trim() || !lastName.trim()) {
      setError("First name and last name are required.");
      return;
    }
    const token = await getToken();
    if (!token) {
      setError("Your session expired. Please sign in again.");
      return;
    }
    setSubmitting(true);
    try {
      const deliveryAddress =
        shipStreet.trim() || shipCity.trim() || shipState.trim() || shipZip.trim()
          ? { street: shipStreet.trim(), city: shipCity.trim(), state: shipState.trim(), zip: shipZip.trim() }
          : null;
      await apiPatch("/api/me", {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        bio: bio.trim() || null,
        city: city.trim() || null,
        phone: phone.trim() || null,
        profilePhotoUrl: profilePhotoUrl || null,
        deliveryAddress,
        privacyLevel,
      });
      router.back();
    } catch (e) {
      const err = e as { error?: string | { formErrors?: string[]; fieldErrors?: Record<string, string[]> }; status?: number };
      let msg = "Failed to save profile.";
      if (err?.status === 401) {
        msg = "Your session expired. Please sign in again.";
      } else if (typeof err?.error === "string") {
        msg = err.error;
      } else if (err?.error && typeof err.error === "object") {
        const fe = err.error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> };
        const parts = [...(fe.formErrors ?? []), ...Object.values(fe.fieldErrors ?? {}).flat()];
        if (parts.length) msg = parts.join(". ");
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirm) return;
    setDeleting(true);
    setError("");
    try {
      await apiPost("/api/me/delete");
      await signOut();
      router.replace("/(auth)/login");
    } catch (e) {
      const err = e as { error?: string; status?: number };
      setError(err?.error ?? "Failed to delete account. Try again.");
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error && !firstName && !lastName) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Edit Profile</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.loadError}>{error}</Text>
          {(error.includes("sign in") || error.includes("session expired")) ? (
            <Pressable
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
              onPress={() => router.replace("/(tabs)/my-community")}
            >
              <Text style={styles.retryBtnText}>Sign in</Text>
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
              onPress={() => {
                setError("");
                setLoading(true);
                getToken().then(async (token) => {
                  if (!token) {
                    setError("Please sign in to edit your profile.");
                    setLoading(false);
                    return;
                  }
                  try {
                    const d = await apiGet<ProfileData>("/api/me");
                    setFirstName(d.firstName ?? "");
                    setLastName(d.lastName ?? "");
                    setBio(d.bio ?? "");
                    setCity(d.city ?? "");
                    setPhone(d.phone ?? "");
                    setProfilePhotoUrl(d.profilePhotoUrl ?? null);
                    if (d.privacyLevel) setPrivacyLevel(d.privacyLevel);
                  } catch (e) {
                    const err = e as { error?: string; status?: number };
                    setError(
                      err?.status === 401
                        ? "Your session expired. Please sign in again."
                        : formatLoadError(e)
                    );
                  } finally {
                    setLoading(false);
                  }
                });
              }}
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          )}
          <Pressable
            style={({ pressed }) => [styles.webFallbackBtn, pressed && { opacity: 0.8 }]}
            onPress={() =>
              router.replace(
                `/web?url=${encodeURIComponent(`${siteBase}/my-community/profile`)}&title=${encodeURIComponent("Edit Profile")}`
              )
            }
          >
            <Text style={styles.retryBtnText}>Open in browser</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const initials = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "?";

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Edit Profile</Text>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.photoSection}>
          {profilePhotoUrl ? (
            <Image source={{ uri: profilePhotoUrl }} style={styles.avatar} accessibilityLabel="Profile photo" />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.photoBtn, pressed && { opacity: 0.7 }]}
            onPress={pickPhoto}
            disabled={uploadingPhoto}
          >
            <Text style={styles.photoBtnText}>
              {uploadingPhoto ? "Uploading…" : profilePhotoUrl ? "Change photo" : "Add photo"}
            </Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>First Name</Text>
          <TextInput
            style={styles.input}
            value={firstName}
            onChangeText={setFirstName}
            placeholder="First name"
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="words"
            autoCorrect={true}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Last Name</Text>
          <TextInput
            style={styles.input}
            value={lastName}
            onChangeText={setLastName}
            placeholder="Last name"
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="words"
            autoCorrect={true}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Bio</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell us about yourself..."
            placeholderTextColor={theme.colors.placeholder}
            multiline
            numberOfLines={4}
            autoCorrect={true}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>City</Text>
          <TextInput
            style={styles.input}
            value={city}
            onChangeText={setCity}
            placeholder="Your city"
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="words"
            autoCorrect={true}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="e.g. 555-123-4567"
            placeholderTextColor={theme.colors.placeholder}
            keyboardType="phone-pad"
            autoCorrect={true}
          />
        </View>

        <View style={styles.sectionDivider} />
        <Text style={styles.sectionTitle}>Profile settings</Text>
        <Text style={styles.fieldNote}>Your name and profile photo are always visible. This setting controls who can see your posts and photos.</Text>
        <View style={styles.privacyRow}>
          <Text style={styles.privacyLabel}>Private profile</Text>
          <Switch
            value={privacyLevel === "friends_only" || privacyLevel === "completely_private"}
            onValueChange={(on) => setPrivacyLevel(on ? "friends_only" : "public")}
            trackColor={{ false: "#ccc", true: theme.colors.primary }}
            thumbColor="#fff"
          />
        </View>
        <Text style={styles.privacyHint}>
          {privacyLevel === "friends_only" || privacyLevel === "completely_private"
            ? "Only friends can see your posts and photos."
            : "Everyone can see your posts and photos."}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>Shipping Address (private)</Text>
          <Text style={styles.fieldNote}>
            Used to autofill checkout. This is never shared publicly.
          </Text>
          <TextInput
            style={styles.input}
            value={shipStreet}
            onChangeText={setShipStreet}
            placeholder="Street address"
            placeholderTextColor={theme.colors.placeholder}
            autoCapitalize="words"
            textContentType="streetAddressLine1"
            autoCorrect={true}
          />
          <View style={[styles.row, styles.addressRow]}>
            <TextInput
              style={[styles.input, styles.inputHalf]}
              value={shipCity}
              onChangeText={setShipCity}
              placeholder="City"
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="words"
              textContentType="addressCity"
              autoCorrect={true}
            />
            <TextInput
              style={[styles.input, styles.inputQuarter]}
              value={shipState}
              onChangeText={setShipState}
              placeholder="State"
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="characters"
              maxLength={2}
              textContentType="addressState"
              autoCorrect={true}
            />
            <TextInput
              style={[styles.input, styles.inputQuarter]}
              value={shipZip}
              onChangeText={setShipZip}
              placeholder="ZIP"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="number-pad"
              textContentType="postalCode"
              autoCorrect={true}
            />
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          style={({ pressed }) => [styles.saveBtn, submitting && styles.saveBtnDisabled, pressed && { opacity: 0.8 }]}
          onPress={handleSave}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save profile</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && { opacity: 0.8 }]}
          onPress={async () => {
            await signOut();
            router.replace("/(tabs)/my-community");
          }}
        >
          <Text style={styles.signOutBtnText}>Sign Out</Text>
        </Pressable>

        <View style={styles.deleteSection}>
          <Text style={styles.deleteLabel}>Delete account</Text>
          <Text style={styles.deleteDescription}>
            Permanently delete your account and all saved data. This cannot be undone.
          </Text>
          {!deleteConfirm ? (
            <Pressable onPress={() => setDeleteConfirm(true)} style={styles.deleteLink}>
              <Text style={styles.deleteLinkText}>I want to delete my account</Text>
            </Pressable>
          ) : (
            <View style={styles.deleteConfirmRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.deleteConfirmBtn,
                  deleting && styles.deleteConfirmBtnDisabled,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={handleDeleteAccount}
                disabled={deleting}
              >
                {deleting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.deleteConfirmBtnText}>Yes, delete my account</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setDeleteConfirm(false)} style={styles.deleteCancel}>
                <Text style={styles.deleteCancelText}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
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
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  photoSection: {
    alignItems: "center",
    marginBottom: 24,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 12,
  },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  avatarInitials: {
    fontSize: 36,
    fontWeight: "bold",
    color: "#fff",
  },
  photoBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  photoBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 6,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: "#000",
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  sectionDivider: { height: 1, backgroundColor: "#eee", marginVertical: 20 },
  sectionTitle: { fontSize: 16, fontWeight: "600", color: theme.colors.heading, marginBottom: 8 },
  privacyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  privacyLabel: { fontSize: 16, color: "#333" },
  privacyHint: { fontSize: 12, color: "#666", marginBottom: 16 },
  fieldNote: {
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
    fontStyle: "italic",
  },
  row: {
    flexDirection: "row",
    gap: 8,
  },
  addressRow: {
    marginTop: 12,
  },
  inputHalf: { flex: 1 },
  inputQuarter: { flex: 0.5 },
  error: {
    color: "#c62828",
    marginBottom: 12,
    fontSize: 14,
  },
  saveBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 8,
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  signOutBtn: {
    marginTop: 24,
    paddingVertical: 10,
    alignSelf: "flex-start",
  },
  signOutBtnText: {
    color: "#666",
    fontSize: 14,
    textDecorationLine: "underline",
  },
  deleteSection: {
    marginTop: 32,
    paddingTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  deleteLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 6,
  },
  deleteDescription: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  deleteLink: { marginBottom: 8 },
  deleteLinkText: {
    fontSize: 14,
    color: "#c62828",
    textDecorationLine: "underline",
  },
  deleteConfirmRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  deleteConfirmBtn: {
    backgroundColor: "#c62828",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  deleteConfirmBtnDisabled: { opacity: 0.6 },
  deleteConfirmBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  deleteCancel: { paddingVertical: 4 },
  deleteCancelText: { fontSize: 14, color: "#666", textDecorationLine: "underline" },
  loadError: {
    color: "#000",
    fontSize: 16,
    textAlign: "center",
    marginBottom: 20,
    paddingHorizontal: 24,
  },
  retryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginBottom: 12,
  },
  retryBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  webFallbackBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
});
