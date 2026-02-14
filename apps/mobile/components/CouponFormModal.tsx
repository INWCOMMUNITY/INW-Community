import { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiUploadFile, getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function toFullUrl(url: string): string {
  return url.startsWith("http")
    ? url
    : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface BusinessOption {
  id: string;
  name: string;
  slug: string;
}

interface CouponFormModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Called when user has no businesses and taps to set up - parent opens WebView */
  onOpenBusinessSetup?: () => void;
}

export function CouponFormModal({
  visible,
  onClose,
  onSuccess,
  onOpenBusinessSetup,
}: CouponFormModalProps) {
  const [businesses, setBusinesses] = useState<BusinessOption[]>([]);
  const [businessId, setBusinessId] = useState("");
  const [name, setName] = useState("");
  const [discount, setDiscount] = useState("");
  const [code, setCode] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [error, setError] = useState("");
  const [showBusinessPicker, setShowBusinessPicker] = useState(false);

  useEffect(() => {
    if (visible) {
      setLoading(true);
      apiGet<BusinessOption[] | { error: string }>("/api/businesses?mine=1")
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          setBusinesses(list);
          setBusinessId((prev) => prev || (list[0]?.id ?? ""));
        })
        .catch(() => setBusinesses([]))
        .finally(() => setLoading(false));
    }
  }, [visible]);

  const resetForm = () => {
    setName("");
    setDiscount("");
    setCode("");
    setImageUrl("");
    setError("");
  };

  const pickImage = async () => {
    const { status } =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to add images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploadingImage(true);
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
        name: "photo.jpg",
      } as unknown as Blob);
      const { url } = await apiUploadFile("/api/upload", formData);
      const fullUrl = toFullUrl(url);
      setImageUrl(fullUrl);
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Photo upload failed. Try again."
      );
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async () => {
    setError("");
    if (!businessId) {
      setError("Select a business first. Add a business from Sponsor Hub if needed.");
      return;
    }
    if (!name.trim()) {
      setError("Coupon name is required.");
      return;
    }
    if (!discount.trim()) {
      setError("Discount is required.");
      return;
    }
    if (!code.trim()) {
      setError("Coupon code is required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/api/coupons", {
        businessId,
        name: name.trim(),
        discount: discount.trim(),
        code: code.trim(),
        imageUrl: imageUrl || null,
      });
      resetForm();
      onClose();
      onSuccess?.();
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Failed to add coupon. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      resetForm();
      onClose();
    }
  };

  const openBusinessSetup = () => {
    onOpenBusinessSetup?.();
    onClose();
  };

  const selectedBusiness = businesses.find((b) => b.id === businessId);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
      >
        <View style={styles.header}>
          <Pressable
            onPress={handleClose}
            disabled={submitting}
            style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}
          >
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </Pressable>
          <Text style={styles.headerTitle}>Offer a Coupon</Text>
          <Pressable
            onPress={handleSubmit}
            disabled={submitting || loading || businesses.length === 0}
            style={({ pressed }) => [
              styles.submitBtn,
              (submitting || loading || businesses.length === 0) &&
                styles.submitBtnDisabled,
              pressed && styles.pressed,
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={theme.colors.buttonText} />
            ) : (
              <Text style={styles.submitBtnText}>Add coupon</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} />
          ) : businesses.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Add a business first</Text>
              <Text style={styles.emptyText}>
                You need at least one business to add a coupon. Set up your
                business from Sponsor Hub.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.webLinkBtn,
                  pressed && styles.pressed,
                ]}
                onPress={openBusinessSetup}
              >
                <Text style={styles.webLinkBtnText}>
                  Set up your business
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Business *</Text>
                <Pressable
                  style={styles.pickerBar}
                  onPress={() => setShowBusinessPicker(true)}
                >
                  <Text
                    style={[
                      styles.pickerBarText,
                      !selectedBusiness && styles.pickerBarPlaceholder,
                    ]}
                  >
                    {selectedBusiness?.name ?? "Select business"}
                  </Text>
                  <Text style={styles.pickerBarHint}>Tap to choose</Text>
                </Pressable>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Coupon name *</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder="e.g. 25% off first month"
                  placeholderTextColor={theme.colors.placeholder}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Discount *</Text>
                <TextInput
                  style={styles.input}
                  value={discount}
                  onChangeText={setDiscount}
                  placeholder="e.g. 25% off first month"
                  placeholderTextColor={theme.colors.placeholder}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Coupon code *</Text>
                <TextInput
                  style={styles.input}
                  value={code}
                  onChangeText={setCode}
                  placeholder="e.g. SAVE25"
                  placeholderTextColor={theme.colors.placeholder}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Logo / image (optional)</Text>
                {imageUrl ? (
                  <View style={styles.imageRow}>
                    <Image
                      source={{ uri: imageUrl }}
                      style={styles.previewImage}
                      resizeMode="cover"
                    />
                    <Pressable
                      style={styles.removeImageBtn}
                      onPress={() => setImageUrl("")}
                    >
                      <Text style={styles.removeImageText}>×</Text>
                    </Pressable>
                  </View>
                ) : null}
                <Pressable
                  style={[
                    styles.uploadBtn,
                    uploadingImage && styles.uploadBtnDisabled,
                  ]}
                  onPress={pickImage}
                  disabled={uploadingImage}
                >
                  <Text style={styles.uploadBtnText}>
                    {uploadingImage
                      ? "Uploading…"
                      : imageUrl
                        ? "Change photo"
                        : "Upload photo"}
                  </Text>
                </Pressable>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </>
          )}
        </ScrollView>

        {showBusinessPicker && (
          <Modal
            visible={showBusinessPicker}
            transparent
            animationType="slide"
            onRequestClose={() => setShowBusinessPicker(false)}
          >
            <Pressable
              style={styles.pickerOverlay}
              onPress={() => setShowBusinessPicker(false)}
            >
              <View style={styles.pickerSheet}>
                <Text style={styles.pickerTitle}>Select business</Text>
                <ScrollView>
                  {businesses.map((b) => (
                    <Pressable
                      key={b.id}
                      style={({ pressed }) => [
                        styles.pickerOption,
                        businessId === b.id && styles.pickerOptionSelected,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => {
                        setBusinessId(b.id);
                        setShowBusinessPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          businessId === b.id && styles.pickerOptionTextSelected,
                        ]}
                      >
                        {b.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <Pressable
                  style={({ pressed }) => [
                    styles.pickerDoneBtn,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setShowBusinessPicker(false)}
                >
                  <Text style={styles.pickerDoneText}>Done</Text>
                </Pressable>
              </View>
            </Pressable>
          </Modal>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  cancelBtnText: {
    fontSize: 16,
    color: theme.colors.primary,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.buttonText,
  },
  pressed: { opacity: 0.8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
  emptyState: {
    padding: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: theme.colors.text,
    marginBottom: 16,
    lineHeight: 22,
  },
  webLinkBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  webLinkBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.buttonText,
  },
  field: { marginBottom: 16 },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 6,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    color: theme.colors.text,
  },
  pickerBar: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerBarText: {
    fontSize: 16,
    color: theme.colors.text,
    flex: 1,
  },
  pickerBarPlaceholder: {
    color: "#999",
  },
  pickerBarHint: {
    fontSize: 12,
    color: "#999",
  },
  imageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  previewImage: {
    width: 80,
    height: 80,
    borderRadius: 6,
  },
  removeImageBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#c00",
    alignItems: "center",
    justifyContent: "center",
  },
  removeImageText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
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
  error: {
    marginTop: 8,
    fontSize: 14,
    color: "#c00",
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: 320,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 16,
  },
  pickerOption: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    marginBottom: 8,
  },
  pickerOptionSelected: {
    backgroundColor: theme.colors.primary,
  },
  pickerOptionText: {
    fontSize: 16,
    color: theme.colors.heading,
  },
  pickerOptionTextSelected: {
    color: theme.colors.buttonText,
  },
  pickerDoneBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  pickerDoneText: {
    color: theme.colors.buttonText,
    fontSize: 16,
    fontWeight: "600",
  },
});
