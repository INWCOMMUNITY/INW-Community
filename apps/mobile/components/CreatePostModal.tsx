import { useState } from "react";
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
import { getToken, apiUploadFile } from "@/lib/api";
import { createPost } from "@/lib/feed-api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface CreatePostModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CreatePostModal({
  visible,
  onClose,
  onSuccess,
}: CreatePostModalProps) {
  const [content, setContent] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState("");

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to add images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (result.canceled) return;
    setUploadingPhoto(true);
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
        formData.append("type", "image");
        const { url } = await apiUploadFile("/api/upload/post", formData);
        const fullUrl = toFullUrl(url);
        setPhotos((p) => (p.includes(fullUrl) ? p : [...p, fullUrl]));
      }
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Photo upload failed. Try again."
      );
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removePhoto = (i: number) => {
    setPhotos((p) => p.filter((_, idx) => idx !== i));
  };

  const handleSubmit = async () => {
    setError("");
    if (!content.trim() && photos.length === 0) {
      setError("Add some text or photos to post.");
      return;
    }
    setSubmitting(true);
    try {
      await createPost({
        content: content.trim() || null,
        photos: photos.length ? photos : undefined,
      });
      setContent("");
      setPhotos([]);
      onClose();
      onSuccess?.();
    } catch (e) {
      setError(
        (e as { error?: string }).error ?? "Failed to create post. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      setContent("");
      setPhotos([]);
      setError("");
      onClose();
    }
  };

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
          <Text style={styles.headerTitle}>Create post</Text>
          <Pressable
            onPress={handleSubmit}
            disabled={submitting || (!content.trim() && photos.length === 0)}
            style={({ pressed }) => [
              styles.submitBtn,
              (submitting || (!content.trim() && photos.length === 0)) &&
                styles.submitBtnDisabled,
              pressed && styles.pressed,
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={theme.colors.buttonText} />
            ) : (
              <Text style={styles.submitBtnText}>Post</Text>
            )}
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <TextInput
            style={styles.textInput}
            placeholder="What's on your mind?"
            placeholderTextColor={theme.colors.placeholder}
            value={content}
            onChangeText={setContent}
            multiline
            editable={!submitting}
          />

          {photos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.photosRow}
            >
              {photos.map((uri, i) => (
                <View key={uri} style={styles.photoWrap}>
                  <Image source={{ uri }} style={styles.photo} />
                  <Pressable
                    style={styles.removePhoto}
                    onPress={() => removePhoto(i)}
                    hitSlop={8}
                  >
                    <Text style={styles.removePhotoText}>×</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.addPhotoBtn,
              pressed && styles.pressed,
              uploadingPhoto && styles.addPhotoBtnDisabled,
            ]}
            onPress={pickImage}
            disabled={uploadingPhoto}
          >
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <Text style={styles.addPhotoBtnText}>Add photo</Text>
            )}
          </Pressable>

          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : null}
        </ScrollView>
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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  textInput: {
    fontSize: 16,
    color: theme.colors.heading,
    minHeight: 120,
    textAlignVertical: "top",
  },
  photosRow: {
    marginTop: 12,
    marginBottom: 12,
  },
  photoWrap: {
    marginRight: 12,
    position: "relative",
  },
  photo: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  removePhoto: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  removePhotoText: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 20,
  },
  addPhotoBtn: {
    alignSelf: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  addPhotoBtnDisabled: {
    opacity: 0.6,
  },
  addPhotoBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  error: {
    marginTop: 12,
    fontSize: 14,
    color: "#c00",
  },
});
