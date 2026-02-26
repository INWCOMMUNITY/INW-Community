import { useState, useEffect, useCallback } from "react";
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
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getToken, apiUploadFile, apiGet } from "@/lib/api";
import { createPost } from "@/lib/feed-api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface TagItem {
  id: string;
  name: string;
  slug: string;
}

interface FriendItem {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
}

interface BusinessItem {
  id: string;
  name: string;
  slug: string;
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
  const insets = useSafeAreaInsets();
  const [content, setContent] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState("");

  // Tags
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [tagResults, setTagResults] = useState<TagItem[]>([]);
  const [tagLoading, setTagLoading] = useState(false);

  // Friends
  const [selectedFriends, setSelectedFriends] = useState<FriendItem[]>([]);
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [friendSearch, setFriendSearch] = useState("");
  const [allFriends, setAllFriends] = useState<FriendItem[]>([]);
  const [friendLoading, setFriendLoading] = useState(false);

  // Businesses
  const [selectedBusiness, setSelectedBusiness] = useState<BusinessItem | null>(null);
  const [businessPickerOpen, setBusinessPickerOpen] = useState(false);
  const [myBusinesses, setMyBusinesses] = useState<BusinessItem[]>([]);
  const [businessLoading, setBusinessLoading] = useState(false);

  useEffect(() => {
    if (!tagPickerOpen) return;
    const timeout = setTimeout(async () => {
      setTagLoading(true);
      try {
        const q = tagSearch.trim();
        const data = await apiGet<{ tags: TagItem[] }>(`/api/tags${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        setTagResults(data.tags ?? []);
      } catch {
        setTagResults([]);
      } finally {
        setTagLoading(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [tagSearch, tagPickerOpen]);

  const loadFriends = useCallback(async () => {
    setFriendLoading(true);
    try {
      const data = await apiGet<{ friends: FriendItem[] }>("/api/me/friends");
      setAllFriends(data.friends ?? []);
    } catch {
      setAllFriends([]);
    } finally {
      setFriendLoading(false);
    }
  }, []);

  const loadBusinesses = useCallback(async () => {
    setBusinessLoading(true);
    try {
      const data = await apiGet<{ businesses: BusinessItem[] }>("/api/me/saved-businesses");
      setMyBusinesses(data.businesses ?? []);
    } catch {
      setMyBusinesses([]);
    } finally {
      setBusinessLoading(false);
    }
  }, []);

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
        tags: selectedTags.length ? selectedTags : undefined,
        taggedMemberIds: selectedFriends.length ? selectedFriends.map((f) => f.id) : undefined,
        ...(selectedBusiness
          ? { sharedItemType: "business" as const, sharedItemId: selectedBusiness.id }
          : {}),
      });
      resetForm();
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

  const resetForm = () => {
    setContent("");
    setPhotos([]);
    setSelectedTags([]);
    setSelectedFriends([]);
    setSelectedBusiness(null);
    setError("");
  };

  const handleClose = () => {
    if (!submitting) {
      resetForm();
      onClose();
    }
  };

  const toggleTag = (tagName: string) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  const addCustomTag = () => {
    const trimmed = tagSearch.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
    }
    setTagSearch("");
  };

  const toggleFriend = (friend: FriendItem) => {
    setSelectedFriends((prev) =>
      prev.some((f) => f.id === friend.id)
        ? prev.filter((f) => f.id !== friend.id)
        : [...prev, friend]
    );
  };

  const filteredFriends = friendSearch.trim()
    ? allFriends.filter((f) => {
        const name = `${f.firstName} ${f.lastName}`.toLowerCase();
        return name.includes(friendSearch.toLowerCase());
      })
    : allFriends;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
      >
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
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

          {/* Selected tags display */}
          {selectedTags.length > 0 && (
            <View style={styles.chipRow}>
              {selectedTags.map((tag) => (
                <Pressable
                  key={tag}
                  style={styles.chip}
                  onPress={() => toggleTag(tag)}
                >
                  <Ionicons name="pricetag" size={12} color={theme.colors.primary} />
                  <Text style={styles.chipText}>{tag}</Text>
                  <Ionicons name="close-circle" size={14} color="#999" />
                </Pressable>
              ))}
            </View>
          )}

          {/* Selected friends display */}
          {selectedFriends.length > 0 && (
            <View style={styles.chipRow}>
              {selectedFriends.map((f) => (
                <Pressable
                  key={f.id}
                  style={styles.chip}
                  onPress={() => toggleFriend(f)}
                >
                  <Ionicons name="person" size={12} color={theme.colors.primary} />
                  <Text style={styles.chipText}>{f.firstName} {f.lastName}</Text>
                  <Ionicons name="close-circle" size={14} color="#999" />
                </Pressable>
              ))}
            </View>
          )}

          {/* Selected business display */}
          {selectedBusiness && (
            <View style={styles.chipRow}>
              <Pressable
                style={styles.chip}
                onPress={() => setSelectedBusiness(null)}
              >
                <Ionicons name="storefront" size={12} color={theme.colors.primary} />
                <Text style={styles.chipText}>{selectedBusiness.name}</Text>
                <Ionicons name="close-circle" size={14} color="#999" />
              </Pressable>
            </View>
          )}

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

          {/* Action buttons row */}
          <View style={styles.actionRow}>
            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                pressed && styles.pressed,
                uploadingPhoto && styles.actionBtnDisabled,
              ]}
              onPress={pickImage}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto ? (
                <ActivityIndicator size="small" color={theme.colors.primary} />
              ) : (
                <>
                  <Ionicons name="image" size={18} color={theme.colors.primary} />
                  <Text style={styles.actionBtnText}>Photo</Text>
                </>
              )}
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => setTagPickerOpen(true)}
            >
              <Ionicons name="pricetag" size={18} color={theme.colors.primary} />
              <Text style={styles.actionBtnText}>Add Tags</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => {
                setFriendPickerOpen(true);
                loadFriends();
              }}
            >
              <Ionicons name="people" size={18} color={theme.colors.primary} />
              <Text style={styles.actionBtnText}>Tag Friends</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [styles.actionBtn, pressed && styles.pressed]}
              onPress={() => {
                setBusinessPickerOpen(true);
                loadBusinesses();
              }}
            >
              <Ionicons name="storefront" size={18} color={theme.colors.primary} />
              <Text style={styles.actionBtnText}>Tag Business</Text>
            </Pressable>
          </View>

          {error ? (
            <Text style={styles.error}>{error}</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Tag Picker Modal */}
      <Modal
        visible={tagPickerOpen}
        animationType="slide"
        onRequestClose={() => setTagPickerOpen(false)}
      >
        <View style={styles.pickerContainer}>
          <View style={[styles.pickerHeader, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.pickerTitle}>Add Tags</Text>
            <Pressable onPress={() => setTagPickerOpen(false)}>
              <Text style={styles.pickerDone}>Done</Text>
            </Pressable>
          </View>
          <View style={styles.pickerSearchRow}>
            <TextInput
              style={styles.pickerSearch}
              placeholder="Search or create a tag..."
              placeholderTextColor="#999"
              value={tagSearch}
              onChangeText={setTagSearch}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={addCustomTag}
            />
            {tagSearch.trim() ? (
              <Pressable style={styles.addTagBtn} onPress={addCustomTag}>
                <Ionicons name="add-circle" size={28} color={theme.colors.primary} />
              </Pressable>
            ) : null}
          </View>
          {tagLoading ? (
            <ActivityIndicator style={{ marginTop: 20 }} color={theme.colors.primary} />
          ) : (
            <FlatList
              data={tagResults}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = selectedTags.includes(item.name);
                return (
                  <Pressable
                    style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                    onPress={() => toggleTag(item.name)}
                  >
                    <Text style={styles.pickerRowText}>{item.name}</Text>
                    {selected && (
                      <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                tagSearch.trim() ? (
                  <Text style={styles.pickerEmpty}>
                    No matching tags. Press + or Return to create "{tagSearch.trim()}".
                  </Text>
                ) : (
                  <Text style={styles.pickerEmpty}>
                    Type to search existing tags or create new ones.
                  </Text>
                )
              }
            />
          )}
        </View>
      </Modal>

      {/* Friend Picker Modal */}
      <Modal
        visible={friendPickerOpen}
        animationType="slide"
        onRequestClose={() => setFriendPickerOpen(false)}
      >
        <View style={styles.pickerContainer}>
          <View style={[styles.pickerHeader, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.pickerTitle}>Tag Friends</Text>
            <Pressable onPress={() => setFriendPickerOpen(false)}>
              <Text style={styles.pickerDone}>Done</Text>
            </Pressable>
          </View>
          <TextInput
            style={[styles.pickerSearch, { marginHorizontal: 16, marginBottom: 8 }]}
            placeholder="Search friends..."
            placeholderTextColor="#999"
            value={friendSearch}
            onChangeText={setFriendSearch}
          />
          {friendLoading ? (
            <ActivityIndicator style={{ marginTop: 20 }} color={theme.colors.primary} />
          ) : (
            <FlatList
              data={filteredFriends}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = selectedFriends.some((f) => f.id === item.id);
                return (
                  <Pressable
                    style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                    onPress={() => toggleFriend(item)}
                  >
                    {item.profilePhotoUrl ? (
                      <Image source={{ uri: item.profilePhotoUrl }} style={styles.friendAvatar} />
                    ) : (
                      <View style={[styles.friendAvatar, styles.friendAvatarPlaceholder]}>
                        <Text style={styles.friendInitials}>
                          {(item.firstName?.[0] ?? "")}{(item.lastName?.[0] ?? "")}
                        </Text>
                      </View>
                    )}
                    <Text style={[styles.pickerRowText, { flex: 1 }]}>
                      {item.firstName} {item.lastName}
                    </Text>
                    {selected && (
                      <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />
                    )}
                  </Pressable>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.pickerEmpty}>
                  {allFriends.length === 0
                    ? "No friends yet. Add friends to tag them in posts."
                    : "No matching friends."}
                </Text>
              }
            />
          )}
        </View>
      </Modal>

      {/* Business Picker Modal */}
      <Modal
        visible={businessPickerOpen}
        animationType="slide"
        onRequestClose={() => setBusinessPickerOpen(false)}
      >
        <View style={styles.pickerContainer}>
          <View style={[styles.pickerHeader, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.pickerTitle}>Tag a Business</Text>
            <Pressable onPress={() => setBusinessPickerOpen(false)}>
              <Text style={styles.pickerDone}>Done</Text>
            </Pressable>
          </View>
          {businessLoading ? (
            <ActivityIndicator style={{ marginTop: 20 }} color={theme.colors.primary} />
          ) : myBusinesses.length === 0 ? (
            <Text style={styles.pickerEmpty}>
              No saved businesses yet. Browse Support Local and save businesses to tag them in posts.
            </Text>
          ) : (
            <FlatList
              data={myBusinesses}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = selectedBusiness?.id === item.id;
                return (
                  <Pressable
                    style={[styles.pickerRow, selected && styles.pickerRowSelected]}
                    onPress={() => {
                      setSelectedBusiness(selected ? null : item);
                      setBusinessPickerOpen(false);
                    }}
                  >
                    <Ionicons name="storefront" size={20} color={theme.colors.primary} style={{ marginRight: 10 }} />
                    <Text style={[styles.pickerRowText, { flex: 1 }]}>{item.name}</Text>
                    {selected && (
                      <Ionicons name="checkmark-circle" size={20} color={theme.colors.primary} />
                    )}
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </Modal>
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
    backgroundColor: theme.colors.primary,
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  cancelBtnText: {
    fontSize: 16,
    color: "#fff",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  submitBtn: {
    backgroundColor: "#fff",
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
    color: theme.colors.primary,
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
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: `${theme.colors.primary}15`,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: `${theme.colors.primary}40`,
  },
  chipText: {
    fontSize: 13,
    color: theme.colors.heading,
    fontWeight: "500",
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
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 16,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: theme.colors.primary,
  },
  actionBtnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  error: {
    marginTop: 12,
    fontSize: 14,
    color: "#c00",
  },

  // Picker modals
  pickerContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: theme.colors.primary,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  pickerDone: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  pickerSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  pickerSearch: {
    flex: 1,
    height: 42,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 15,
    color: theme.colors.heading,
  },
  addTagBtn: {
    padding: 4,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  pickerRowSelected: {
    backgroundColor: `${theme.colors.primary}10`,
  },
  pickerRowText: {
    fontSize: 15,
    color: theme.colors.heading,
  },
  pickerEmpty: {
    textAlign: "center",
    color: "#999",
    fontSize: 14,
    marginTop: 32,
    paddingHorizontal: 24,
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 12,
  },
  friendAvatarPlaceholder: {
    backgroundColor: `${theme.colors.primary}20`,
    alignItems: "center",
    justifyContent: "center",
  },
  friendInitials: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
});
