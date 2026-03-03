import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "https://www.inwcommunity.com";
function toFullUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith("http") ? url : `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface GroupDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  rules: string | null;
  isMember: boolean;
  memberRole: string | null;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  _count?: { members: number; groupPosts: number };
}

export default function GroupDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [rulesModalOpen, setRulesModalOpen] = useState(false);

  const load = useCallback(async () => {
    if (!slug) return;
    try {
      const data = await apiGet<GroupDetail>(`/api/groups/${slug}`);
      setGroup(data);
    } catch {
      setGroup(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleJoin = async (agreedToRules = false) => {
    if (!group || joining) return;
    if (group.rules?.trim() && !agreedToRules) {
      setRulesModalOpen(true);
      return;
    }
    setJoining(true);
    try {
      await apiPost(`/api/groups/${group.slug}/join`, { agreedToRules: true });
      setGroup((g) => (g ? { ...g, isMember: true, memberRole: "member" } : g));
      setRulesModalOpen(false);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err?.error ?? "Failed to join group");
    } finally {
      setJoining(false);
    }
  };

  if (loading || !group) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        {!loading && !group && <Text style={styles.notFound}>Group not found.</Text>}
      </View>
    );
  }

  const coverUri = toFullUrl(group.coverImageUrl);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {coverUri ? (
        <Image source={{ uri: coverUri }} style={styles.cover} resizeMode="cover" />
      ) : (
        <View style={styles.coverPlaceholder}>
          <Ionicons name="people" size={48} color={theme.colors.primary} />
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.name}>{group.name}</Text>
        {group.category ? (
          <Text style={styles.category}>{group.category}</Text>
        ) : null}
        {group._count && (
          <Text style={styles.meta}>
            {group._count.members} members · {group._count.groupPosts} posts
          </Text>
        )}
        {group.description ? (
          <Text style={styles.description}>{group.description}</Text>
        ) : null}
        {group.rules?.trim() ? (
          <View style={styles.rulesBlock}>
            <Text style={styles.rulesTitle}>Group rules</Text>
            <Text style={styles.rulesText}>{group.rules}</Text>
          </View>
        ) : null}
        {!group.isMember && (
          <Pressable
            style={({ pressed }) => [styles.joinBtn, pressed && styles.joinBtnPressed]}
            onPress={() => handleJoin(false)}
            disabled={joining}
          >
            {joining ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.joinBtnText}>Join group</Text>
            )}
          </Pressable>
        )}
        {group.isMember && group.memberRole === "admin" && (
          <Text style={styles.adminBadge}>Admin</Text>
        )}
      </View>

      {rulesModalOpen && group.rules?.trim() && (
        <Modal visible transparent animationType="fade">
          <Pressable style={styles.modalOverlay} onPress={() => setRulesModalOpen(false)}>
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>Group rules</Text>
              <ScrollView style={styles.modalRulesScroll}>
                <Text style={styles.modalRulesText}>{group.rules}</Text>
              </ScrollView>
              <Text style={styles.modalHint}>You must agree to the rules to join.</Text>
              <View style={styles.modalActions}>
                <Pressable style={styles.modalCancelBtn} onPress={() => setRulesModalOpen(false)}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.modalAgreeBtn, pressed && { opacity: 0.8 }]}
                  onPress={() => handleJoin(true)}
                  disabled={joining}
                >
                  {joining ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.modalAgreeText}>I agree</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Modal>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  notFound: { marginTop: 12, fontSize: 16, color: theme.colors.placeholder },
  cover: { width: "100%", height: 200, backgroundColor: theme.colors.cream },
  coverPlaceholder: {
    width: "100%",
    height: 200,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { padding: 16 },
  name: { fontSize: 22, fontWeight: "700", color: theme.colors.heading, marginBottom: 4 },
  category: { fontSize: 14, color: theme.colors.primary, marginBottom: 4 },
  meta: { fontSize: 14, color: theme.colors.placeholder, marginBottom: 12 },
  description: { fontSize: 16, color: theme.colors.heading, lineHeight: 24, marginBottom: 16 },
  rulesBlock: { marginBottom: 16, padding: 12, backgroundColor: "#f5f5f5", borderRadius: 8 },
  rulesTitle: { fontSize: 14, fontWeight: "600", marginBottom: 6 },
  rulesText: { fontSize: 14, color: theme.colors.heading, lineHeight: 20 },
  joinBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  joinBtnPressed: { opacity: 0.8 },
  joinBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  adminBadge: { fontSize: 14, color: theme.colors.primary, fontWeight: "600", marginTop: 8 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  modalSheet: { backgroundColor: "#fff", borderRadius: 12, padding: 20, maxHeight: "80%" },
  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12 },
  modalRulesScroll: { maxHeight: 200, marginBottom: 12 },
  modalRulesText: { fontSize: 15, lineHeight: 22, color: theme.colors.heading },
  modalHint: { fontSize: 13, color: theme.colors.placeholder, marginBottom: 16 },
  modalActions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
  modalCancelBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  modalCancelText: { fontSize: 16, color: theme.colors.placeholder },
  modalAgreeBtn: { backgroundColor: theme.colors.primary, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  modalAgreeText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
