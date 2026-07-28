import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Switch,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { AppImage } from "@/components/AppImage";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface CollectionPreviewItem {
  id: string;
  photo: string | null;
  title: string;
}

interface Collection {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  itemCount: number;
  previewItems: CollectionPreviewItem[];
  createdAt: string;
  updatedAt: string;
}

function resolvePhotoUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function CollectionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member } = useAuth();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await apiGet<Collection[]>("/api/collections");
      setCollections(data);
    } catch {
      setError("Failed to load collections");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (member) load();
    else setLoading(false);
  }, [member, load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await apiPost<Collection>("/api/collections", {
        name: newName.trim(),
        description: newDescription.trim() || undefined,
        isPublic: newIsPublic,
      });
      setCollections((prev) => [created, ...prev]);
      setCreateModalOpen(false);
      setNewName("");
      setNewDescription("");
      setNewIsPublic(false);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to create collection");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert(
      "Delete Collection",
      `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await apiDelete(`/api/collections/${id}`);
              setCollections((prev) => prev.filter((c) => c.id !== id));
            } catch {
              Alert.alert("Error", "Failed to delete collection");
            }
          },
        },
      ]
    );
  };

  const renderItem = ({ item }: { item: Collection }) => (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
      onPress={() => router.push(`/collections/${item.id}` as never)}
      onLongPress={() => handleDelete(item.id, item.name)}
    >
      <View style={styles.cardPreview}>
        {item.previewItems.length > 0 ? (
          item.previewItems.slice(0, 4).map((p, i) => {
            const url = resolvePhotoUrl(p.photo);
            return (
              <View
                key={p.id}
                style={[
                  styles.previewImageWrap,
                  item.previewItems.length === 1 && styles.previewImageWrapFull,
                ]}
              >
                {url ? (
                  <AppImage
                    uri={url}
                    targetWidth={80}
                    style={styles.previewImage}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.previewPlaceholder}>
                    <Ionicons name="image-outline" size={20} color="#999" />
                  </View>
                )}
              </View>
            );
          })
        ) : (
          <View style={styles.emptyPreview}>
            <Ionicons name="images-outline" size={32} color="#ccc" />
          </View>
        )}
      </View>
      <View style={styles.cardInfo}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.name}
          </Text>
          {item.isPublic && (
            <Ionicons name="globe-outline" size={14} color={theme.colors.text} />
          )}
        </View>
        <Text style={styles.cardCount}>
          {item.itemCount} {item.itemCount === 1 ? "item" : "items"}
        </Text>
      </View>
    </Pressable>
  );

  if (!member) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>My Collections</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.center}>
          <Ionicons name="bookmark-outline" size={48} color={theme.colors.primary} />
          <Text style={styles.emptyTitle}>Sign in to create collections</Text>
          <Text style={styles.emptyText}>
            Save your favorite items into collections to find them later.
          </Text>
          <Pressable
            style={styles.signInBtn}
            onPress={() => router.push("/(tabs)/my-community")}
          >
            <Text style={styles.signInBtnText}>Sign In</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>My Collections</Text>
        <Pressable onPress={() => setCreateModalOpen(true)} style={styles.addBtn}>
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={collections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={2}
          contentContainerStyle={styles.listContent}
          columnWrapperStyle={styles.row}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              colors={[theme.colors.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="bookmark-outline" size={48} color={theme.colors.primary} />
              <Text style={styles.emptyTitle}>No collections yet</Text>
              <Text style={styles.emptyText}>
                Create a collection to save and organize your favorite items.
              </Text>
              <Pressable
                style={styles.createFirstBtn}
                onPress={() => setCreateModalOpen(true)}
              >
                <Text style={styles.createFirstBtnText}>Create Collection</Text>
              </Pressable>
            </View>
          }
        />
      )}

      <Modal
        visible={createModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => !creating && setCreateModalOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !creating && setCreateModalOpen(false)}
        >
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>New Collection</Text>
            <TextInput
              style={styles.input}
              placeholder="Collection name"
              placeholderTextColor="#999"
              value={newName}
              onChangeText={setNewName}
              autoFocus
              maxLength={100}
            />
            <TextInput
              style={[styles.input, styles.descriptionInput]}
              placeholder="Description (optional)"
              placeholderTextColor="#999"
              value={newDescription}
              onChangeText={setNewDescription}
              multiline
              numberOfLines={3}
              maxLength={500}
            />
            <View style={styles.publicRow}>
              <Text style={styles.publicLabel}>Make public</Text>
              <Switch
                value={newIsPublic}
                onValueChange={setNewIsPublic}
                trackColor={{ false: "#ccc", true: theme.colors.cream }}
                thumbColor={newIsPublic ? theme.colors.primary : "#f4f4f4"}
              />
            </View>
            <Text style={styles.publicHint}>
              Public collections can be shared with others via link.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setCreateModalOpen(false)}
                disabled={creating}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.createBtn, creating && { opacity: 0.6 }]}
                onPress={handleCreate}
                disabled={creating || !newName.trim()}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.createBtnText}>Create</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
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
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
  },
  backBtn: {
    padding: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
  },
  addBtn: {
    padding: 4,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  listContent: {
    padding: 16,
    paddingBottom: 48,
  },
  row: {
    justifyContent: "space-between",
    marginBottom: 16,
  },
  card: {
    width: "48%",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  cardPreview: {
    width: "100%",
    aspectRatio: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#f5f5f5",
  },
  previewImageWrap: {
    width: "50%",
    height: "50%",
  },
  previewImageWrapFull: {
    width: "100%",
    height: "100%",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  previewPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eee",
  },
  emptyPreview: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: {
    padding: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  cardCount: {
    fontSize: 12,
    color: theme.colors.text,
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: "center",
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  createFirstBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  createFirstBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  signInBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  signInBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  errorText: {
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 16,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  retryBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 16,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.cream,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 12,
  },
  descriptionInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  publicRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  publicLabel: {
    fontSize: 16,
    color: theme.colors.heading,
  },
  publicHint: {
    fontSize: 12,
    color: theme.colors.text,
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    fontSize: 16,
    color: theme.colors.text,
  },
  createBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    minWidth: 80,
    alignItems: "center",
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
