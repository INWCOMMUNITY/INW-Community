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
  Share,
  useWindowDimensions,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { AppImage } from "@/components/AppImage";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

const CARD_GAP = 12;
const CARD_PADDING = 16;

interface CollectionItem {
  collectionItemId: string;
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  quantity: number;
  status: string;
  category: string | null;
  business?: { id: string; name: string; slug: string; logoUrl?: string | null } | null;
  addedAt: string;
}

interface CollectionDetail {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  isOwner: boolean;
  ownerName: string;
  items: CollectionItem[];
  createdAt: string;
  updatedAt: string;
}

function resolvePhotoUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = (width - CARD_PADDING * 2 - CARD_GAP) / 2;
  const { member } = useAuth();

  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (!id) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const data = await apiGet<CollectionDetail>(`/api/collections/${id}`);
      setCollection(data);
      setEditName(data.name);
      setEditDescription(data.description ?? "");
      setEditIsPublic(data.isPublic);
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 404) {
        setError("Collection not found");
      } else {
        setError("Failed to load collection");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (!collection || !editName.trim()) return;
    setSaving(true);
    try {
      const updated = await apiPatch<{ name: string; description: string | null; isPublic: boolean }>(
        `/api/collections/${collection.id}`,
        {
          name: editName.trim(),
          description: editDescription.trim() || null,
          isPublic: editIsPublic,
        }
      );
      setCollection((prev) =>
        prev ? { ...prev, name: updated.name, description: updated.description, isPublic: updated.isPublic } : prev
      );
      setEditModalOpen(false);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to update collection");
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveItem = (collectionItemId: string, title: string) => {
    Alert.alert(
      "Remove Item",
      `Remove "${title}" from this collection?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await apiDelete(`/api/collections/${id}/items/${collectionItemId}`);
              setCollection((prev) =>
                prev ? { ...prev, items: prev.items.filter((i) => i.collectionItemId !== collectionItemId) } : prev
              );
            } catch {
              Alert.alert("Error", "Failed to remove item");
            }
          },
        },
      ]
    );
  };

  const handleShare = async () => {
    if (!collection?.isPublic) {
      Alert.alert("Make Collection Public", "You need to make this collection public before sharing it.", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Make Public",
          onPress: async () => {
            try {
              await apiPatch(`/api/collections/${collection!.id}`, { isPublic: true });
              setCollection((prev) => (prev ? { ...prev, isPublic: true } : prev));
              setEditIsPublic(true);
              const shareUrl = `${siteBase}/collections/${collection!.id}`;
              await Share.share({
                title: collection!.name,
                message: `Check out my collection "${collection!.name}" on NWC: ${shareUrl}`,
                url: shareUrl,
              });
            } catch {
              Alert.alert("Error", "Failed to share collection");
            }
          },
        },
      ]);
      return;
    }
    try {
      const shareUrl = `${siteBase}/collections/${collection.id}`;
      await Share.share({
        title: collection.name,
        message: `Check out my collection "${collection.name}" on NWC: ${shareUrl}`,
        url: shareUrl,
      });
    } catch {
      // user cancelled
    }
  };

  const renderItem = ({ item }: { item: CollectionItem }) => {
    const photoUrl = resolvePhotoUrl(item.photos?.[0]);
    const isUnavailable = item.status !== "active" || item.quantity <= 0;
    return (
      <Pressable
        style={({ pressed }) => [styles.card, { width: cardWidth }, pressed && { opacity: 0.9 }]}
        onPress={() => router.push(`/product/${item.slug}` as never)}
        onLongPress={
          collection?.isOwner
            ? () => handleRemoveItem(item.collectionItemId, item.title)
            : undefined
        }
      >
        <View style={[styles.cardImage, { width: cardWidth, height: cardWidth * 1.25 }]}>
          {photoUrl ? (
            <AppImage
              uri={photoUrl}
              targetWidth={cardWidth}
              style={styles.image}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="image-outline" size={32} color="#ccc" />
            </View>
          )}
          {isUnavailable && (
            <View style={styles.unavailableOverlay}>
              <Text style={styles.unavailableText}>
                {item.status === "sold_out" || item.quantity <= 0 ? "Sold Out" : "Unavailable"}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.cardPrice}>{formatPrice(item.priceCents)}</Text>
          {item.business?.name && (
            <Text style={styles.cardSeller} numberOfLines={1}>
              {item.business.name}
            </Text>
          )}
        </View>
      </Pressable>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Collection</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  if (error || !collection) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Collection</Text>
          <View style={{ width: 32 }} />
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Collection not found"}</Text>
          <Pressable style={styles.retryBtn} onPress={() => load()}>
            <Text style={styles.retryBtnText}>Retry</Text>
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
        <Text style={styles.headerTitle} numberOfLines={1}>
          {collection.name}
        </Text>
        {collection.isOwner ? (
          <Pressable onPress={() => setEditModalOpen(true)} style={styles.editBtn}>
            <Ionicons name="settings-outline" size={22} color="#fff" />
          </Pressable>
        ) : (
          <View style={{ width: 32 }} />
        )}
      </View>

      <FlatList
        data={collection.items}
        keyExtractor={(item) => item.collectionItemId}
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
        ListHeaderComponent={
          <View style={styles.collectionInfo}>
            {collection.description && (
              <Text style={styles.description}>{collection.description}</Text>
            )}
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>
                {collection.items.length} {collection.items.length === 1 ? "item" : "items"}
              </Text>
              {!collection.isOwner && (
                <Text style={styles.metaText}>by {collection.ownerName}</Text>
              )}
              {collection.isPublic && (
                <View style={styles.publicBadge}>
                  <Ionicons name="globe-outline" size={12} color={theme.colors.primary} />
                  <Text style={styles.publicBadgeText}>Public</Text>
                </View>
              )}
            </View>
            {collection.isOwner && (
              <Pressable style={styles.shareBtn} onPress={handleShare}>
                <Ionicons name="share-outline" size={18} color={theme.colors.primary} />
                <Text style={styles.shareBtnText}>Share Collection</Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="images-outline" size={48} color="#ccc" />
            <Text style={styles.emptyTitle}>No items yet</Text>
            <Text style={styles.emptyText}>
              {collection.isOwner
                ? "Add items from the store to this collection."
                : "This collection is empty."}
            </Text>
          </View>
        }
      />

      <Modal
        visible={editModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => !saving && setEditModalOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => !saving && setEditModalOpen(false)}
        >
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>Edit Collection</Text>
            <TextInput
              style={styles.input}
              placeholder="Collection name"
              placeholderTextColor="#999"
              value={editName}
              onChangeText={setEditName}
              maxLength={100}
            />
            <TextInput
              style={[styles.input, styles.descriptionInput]}
              placeholder="Description (optional)"
              placeholderTextColor="#999"
              value={editDescription}
              onChangeText={setEditDescription}
              multiline
              numberOfLines={3}
              maxLength={500}
            />
            <View style={styles.publicRow}>
              <Text style={styles.publicLabel}>Make public</Text>
              <Switch
                value={editIsPublic}
                onValueChange={setEditIsPublic}
                trackColor={{ false: "#ccc", true: theme.colors.cream }}
                thumbColor={editIsPublic ? theme.colors.primary : "#f4f4f4"}
              />
            </View>
            <Text style={styles.publicHint}>
              Public collections can be shared with others via link.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.cancelBtn}
                onPress={() => setEditModalOpen(false)}
                disabled={saving}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving || !editName.trim()}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
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
  editBtn: {
    padding: 4,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  listContent: {
    padding: CARD_PADDING,
    paddingBottom: 48,
  },
  row: {
    justifyContent: "space-between",
    marginBottom: CARD_GAP,
  },
  collectionInfo: {
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  description: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  metaText: {
    fontSize: 13,
    color: theme.colors.text,
  },
  publicBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    backgroundColor: theme.colors.creamAlt,
  },
  publicBadgeText: {
    fontSize: 12,
    color: theme.colors.primary,
    fontWeight: "500",
  },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  shareBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  card: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.cream,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  cardImage: {
    backgroundColor: "#f5f5f5",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  imagePlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  unavailableOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  unavailableText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 14,
  },
  cardInfo: {
    padding: 10,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  cardPrice: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.primary,
    marginBottom: 2,
  },
  cardSeller: {
    fontSize: 11,
    color: theme.colors.text,
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
  saveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    minWidth: 80,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
