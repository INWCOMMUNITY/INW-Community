import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { theme } from "@/lib/theme";
import { getDrafts, deleteDraft, type StoreItemDraft } from "@/lib/drafts";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DraftsScreen() {
  const router = useRouter();
  const [drafts, setDrafts] = useState<StoreItemDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      getDrafts().then(setDrafts).finally(() => setLoading(false));
    }, [])
  );

  const handleDelete = (draft: StoreItemDraft) => {
    Alert.alert(
      "Delete draft?",
      `Remove "${draft.title || "Untitled"}" from drafts?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteDraft(draft.id);
            setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.hint}>
        Drafts are saved on this device. Tap a draft to continue editing.
      </Text>
      {drafts.length === 0 ? (
        <Text style={styles.empty}>No drafts yet.</Text>
      ) : (
        <FlatList
          data={drafts}
          keyExtractor={(d) => d.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Pressable
                style={({ pressed }) => [styles.cardMain, pressed && { opacity: 0.9 }]}
                onPress={() =>
                  router.push(`/seller-hub/store/new?draftId=${item.id}` as any)
                }
              >
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title || "Untitled draft"}
                </Text>
                <Text style={styles.cardMeta}>
                  {formatDate(item.savedAt)}
                  {item.category ? ` · ${item.category}` : ""}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.deleteBtn, pressed && { opacity: 0.8 }]}
                onPress={() => handleDelete(item)}
              >
                <Text style={styles.deleteBtnText}>Delete</Text>
              </Pressable>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  hint: {
    fontSize: 14,
    color: theme.colors.labelMuted,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  empty: {
    fontSize: 16,
    color: theme.colors.labelMuted,
    padding: 24,
  },
  list: { padding: 16, paddingBottom: 40 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
  },
  cardMain: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#333" },
  cardMeta: { fontSize: 12, color: theme.colors.labelMuted, marginTop: 4 },
  deleteBtn: { padding: 8 },
  deleteBtnText: { fontSize: 14, color: "#c62828", fontWeight: "600" },
});
