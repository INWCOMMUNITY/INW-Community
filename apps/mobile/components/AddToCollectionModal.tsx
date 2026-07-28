import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  ActivityIndicator,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "expo-router";

interface CollectionSummary {
  id: string;
  name: string;
  itemCount: number;
}

interface AddToCollectionModalProps {
  visible: boolean;
  onClose: () => void;
  storeItemId: string;
  storeItemTitle: string;
}

export function AddToCollectionModal({
  visible,
  onClose,
  storeItemId,
  storeItemTitle,
}: AddToCollectionModalProps) {
  const { member } = useAuth();
  const router = useRouter();
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<CollectionSummary[]>("/api/collections");
      setCollections(data);
    } catch {
      setCollections([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible && member) {
      load();
    }
  }, [visible, member, load]);

  const handleAdd = async (collectionId: string) => {
    setAdding(collectionId);
    try {
      await apiPost(`/api/collections/${collectionId}/items`, { storeItemId });
      setCollections((prev) =>
        prev.map((c) =>
          c.id === collectionId ? { ...c, itemCount: c.itemCount + 1 } : c
        )
      );
      Alert.alert("Added", `"${storeItemTitle}" added to collection.`);
      onClose();
    } catch (e) {
      const err = e as { error?: string; status?: number };
      if (err.status === 409) {
        Alert.alert("Already Added", "This item is already in this collection.");
      } else {
        Alert.alert("Error", err.error ?? "Failed to add item");
      }
    } finally {
      setAdding(null);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await apiPost<{ id: string; name: string; itemCount: number }>(
        "/api/collections",
        { name: newName.trim() }
      );
      setCollections((prev) => [{ id: created.id, name: created.name, itemCount: 0 }, ...prev]);
      setShowCreate(false);
      setNewName("");
      handleAdd(created.id);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to create collection");
    } finally {
      setCreating(false);
    }
  };

  if (!member) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.content} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>Add to Collection</Text>
            <View style={styles.signInContainer}>
              <Text style={styles.signInText}>
                Sign in to save items to your collections.
              </Text>
              <Pressable
                style={styles.signInBtn}
                onPress={() => {
                  onClose();
                  router.push("/(tabs)/my-community");
                }}
              >
                <Text style={styles.signInBtnText}>Sign In</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.content} onPress={(e) => e.stopPropagation()}>
            <View style={styles.header}>
            <Text style={styles.title}>Add to Collection</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={theme.colors.heading} />
            </Pressable>
          </View>

          {showCreate ? (
            <View style={styles.createForm}>
              <TextInput
                style={styles.input}
                placeholder="Collection name"
                placeholderTextColor="#999"
                value={newName}
                onChangeText={setNewName}
                autoFocus
                maxLength={100}
              />
              <View style={styles.createActions}>
                <Pressable
                  style={styles.cancelCreateBtn}
                  onPress={() => {
                    setShowCreate(false);
                    setNewName("");
                  }}
                  disabled={creating}
                >
                  <Text style={styles.cancelCreateBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.createBtn, creating && { opacity: 0.6 }]}
                  onPress={handleCreate}
                  disabled={creating || !newName.trim()}
                >
                  {creating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.createBtnText}>Create & Add</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : (
            <>
              <Pressable style={styles.newCollectionBtn} onPress={() => setShowCreate(true)}>
                <Ionicons name="add-circle-outline" size={24} color={theme.colors.primary} />
                <Text style={styles.newCollectionBtnText}>Create New Collection</Text>
              </Pressable>

              {loading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
              ) : collections.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>No collections yet.</Text>
                </View>
              ) : (
                <FlatList
                  data={collections}
                  keyExtractor={(item) => item.id}
                  style={styles.list}
                  renderItem={({ item }) => (
                    <Pressable
                      style={({ pressed }) => [
                        styles.collectionRow,
                        pressed && { backgroundColor: "#f5f5f5" },
                      ]}
                      onPress={() => handleAdd(item.id)}
                      disabled={adding !== null}
                    >
                      <View style={styles.collectionInfo}>
                        <Text style={styles.collectionName}>{item.name}</Text>
                        <Text style={styles.collectionCount}>
                          {item.itemCount} {item.itemCount === 1 ? "item" : "items"}
                        </Text>
                      </View>
                      {adding === item.id ? (
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                      ) : (
                        <Ionicons name="add" size={24} color={theme.colors.primary} />
                      )}
                    </Pressable>
                  )}
                />
              )}
            </>
          )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  content: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "70%",
    minHeight: 300,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  closeBtn: {
    padding: 4,
  },
  newCollectionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  newCollectionBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  list: {
    flex: 1,
  },
  collectionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  collectionInfo: {
    flex: 1,
  },
  collectionName: {
    fontSize: 16,
    fontWeight: "500",
    color: theme.colors.heading,
  },
  collectionCount: {
    fontSize: 13,
    color: theme.colors.text,
    marginTop: 2,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
    color: theme.colors.text,
  },
  createForm: {
    padding: 20,
  },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.cream,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 16,
  },
  createActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelCreateBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  cancelCreateBtnText: {
    fontSize: 16,
    color: theme.colors.text,
  },
  createBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    minWidth: 100,
    alignItems: "center",
  },
  createBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  signInContainer: {
    padding: 32,
    alignItems: "center",
  },
  signInText: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 16,
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
});
