import { useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Switch,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiUploadFile } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL?.replace(/\/api.*$/, "") || "https://www.inwcommunity.com";
function toFullUrl(url: string): string {
  return url.startsWith("http") ? url : `${API_BASE}${url.startsWith("/") ? "" : "/"}${url}`;
}

interface Group {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  rules: string | null;
  isMember: boolean;
  memberRole: string | null;
  _count?: { members: number; groupPosts: number };
}

export default function GroupsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<Group[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createCategory, setCreateCategory] = useState("");
  const [createRules, setCreateRules] = useState("");
  const [createCoverUrl, setCreateCoverUrl] = useState<string | null>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createAllowBusinessPosts, setCreateAllowBusinessPosts] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [rulesJoinTarget, setRulesJoinTarget] = useState<Group | null>(null);
  const [joinBusyId, setJoinBusyId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (categoryFilter.trim()) params.set("category", categoryFilter.trim());
      const q = params.toString() ? `?${params.toString()}` : "";
      const data = await apiGet<{ groups: Group[] }>(`/api/groups${q}`);
      setGroups(data?.groups ?? []);
    } catch {
      setGroups([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [searchQuery, categoryFilter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const completeJoin = async (group: Group) => {
    setJoinBusyId(group.id);
    try {
      const body = group.rules?.trim() ? { agreedToRules: true as const } : {};
      await apiPost(`/api/groups/${group.slug}/join`, body);
      setGroups((prev) =>
        prev.map((g) => (g.id === group.id ? { ...g, isMember: true, memberRole: "member" } : g))
      );
      setRulesJoinTarget(null);
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err?.error ?? "Failed to join group");
    } finally {
      setJoinBusyId(null);
    }
  };

  const handleJoin = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    if (group.rules?.trim()) {
      setRulesJoinTarget(group);
      return;
    }
    void completeJoin(group);
  };

  const pickCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow access to photos to add a group photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    setUploadingCover(true);
    try {
      const formData = new FormData();
      formData.append("file", {
        uri: result.assets[0].uri,
        type: result.assets[0].mimeType ?? "image/jpeg",
        name: "photo.jpg",
      } as unknown as Blob);
      formData.append("type", "image");
      const { url } = await apiUploadFile("/api/upload/post", formData);
      const fullUrl = toFullUrl(url);
      setCreateCoverUrl(fullUrl);
    } catch (e) {
      Alert.alert("Error", (e as { error?: string })?.error ?? "Failed to upload photo.");
    } finally {
      setUploadingCover(false);
    }
  };

  const handleCreate = async () => {
    if (!createName.trim()) {
      Alert.alert("Error", "Enter a group name");
      return;
    }
    setCreating(true);
    try {
      await apiPost("/api/group-creation-requests", {
        name: createName.trim(),
        description: createDescription.trim() || undefined,
        category: createCategory.trim() || undefined,
        coverImageUrl: createCoverUrl ?? undefined,
        rules: createRules.trim() || undefined,
        allowBusinessPosts: createAllowBusinessPosts,
      });
      setShowCreate(false);
      setCreateName("");
      setCreateDescription("");
      setCreateCategory("");
      setCreateRules("");
      setCreateCoverUrl(null);
      setCreateAllowBusinessPosts(false);
      load();
      Alert.alert(
        "Request sent",
        "Your group request was submitted. We will email you if it is not approved. You will be able to open the group from this list once an admin approves it."
      );
    } catch (e) {
      const err = e as { error?: string };
      const msg =
        typeof err?.error === "string"
          ? err.error
          : "Failed to submit group request. Try again.";
      Alert.alert("Error", msg);
    } finally {
      setCreating(false);
    }
  };

  const categoriesFromGroups = groups
    .map((g) => g.category)
    .filter((c): c is string => !!c?.trim());
  const uniqueCategories = [...new Set(categoriesFromGroups)];

  return (
    <>
    <KeyboardAvoidingView
      style={styles.keyboardRoot}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 64 : 0}
    >
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
      }
    >
      <View style={styles.adminCallout}>
        <View style={styles.adminCalloutTopBar} />
        <Ionicons name="shield-checkmark" size={40} color={theme.colors.primary} style={styles.adminCalloutIcon} />
        <Text style={styles.adminCalloutTitle}>Become a Group Admin</Text>
        <Text style={styles.adminCalloutBody}>
          Submit a request to start a group. Northwest Community reviews each request. If your request is not approved,
          we will email you with a short explanation.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.adminCalloutBtn, pressed && styles.buttonPressed]}
          onPress={() => setShowCreate(true)}
        >
          <Text style={styles.adminCalloutBtnText}>Request a group</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search groups..."
          placeholderTextColor={theme.colors.placeholder}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={true}
        />
      </View>

      {uniqueCategories.length > 0 && (
        <ScrollView
          horizontal
          directionalLockEnabled
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
          style={styles.filterRow}
          contentContainerStyle={styles.filterRowContent}
        >
          <Pressable
            style={[styles.filterChip, !categoryFilter && styles.filterChipActive]}
            onPress={() => setCategoryFilter("")}
          >
            <Text style={[styles.filterChipText, !categoryFilter && styles.filterChipTextActive]}>All</Text>
          </Pressable>
          {uniqueCategories.map((c) => (
            <Pressable
              key={c}
              style={[styles.filterChip, categoryFilter === c && styles.filterChipActive]}
              onPress={() => setCategoryFilter(c)}
            >
              <Text style={[styles.filterChipText, categoryFilter === c && styles.filterChipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : groups.length === 0 ? (
        <Text style={styles.emptyText}>
          No groups found. Create one above or try a different search.
        </Text>
      ) : (
        groups.map((g) => (
          <Pressable
            key={g.id}
            style={({ pressed }) => [styles.groupCard, pressed && styles.buttonPressed]}
            onPress={() => (router.push as (href: string) => void)(`/community/group/${g.slug}`)}
          >
            {g.coverImageUrl ? (
              <Image source={{ uri: g.coverImageUrl.startsWith("/") ? `${API_BASE}${g.coverImageUrl}` : g.coverImageUrl }} style={styles.cover} />
            ) : (
              <View style={styles.coverPlaceholder}>
                <Ionicons name="people" size={32} color={theme.colors.primary} />
              </View>
            )}
            <View style={styles.groupInfo}>
              <Text style={styles.groupName} numberOfLines={1}>{g.name}</Text>
              {g.description && (
                <Text style={styles.groupDesc} numberOfLines={2}>{g.description}</Text>
              )}
              {g._count && (
                <Text style={styles.groupMeta}>
                  {g._count.members} members · {g._count.groupPosts} posts
                </Text>
              )}
              {!g.isMember && (
                <Pressable
                  style={({ pressed }) => [styles.joinBtn, pressed && styles.buttonPressed]}
                  onPress={() => handleJoin(g.id)}
                >
                  <Text style={styles.joinBtnText}>Join</Text>
                </Pressable>
              )}
              {g.isMember && g.memberRole === "admin" && (
                <Text style={styles.adminBadge}>Admin</Text>
              )}
            </View>
          </Pressable>
        ))
      )}

      <Modal visible={!!rulesJoinTarget} transparent animationType="fade">
        <View style={styles.joinModalOverlay}>
          <Pressable style={styles.joinModalBackdrop} onPress={() => setRulesJoinTarget(null)} />
          <View style={styles.joinModalSheet}>
            <Text style={styles.joinModalTitle}>Group rules</Text>
            <ScrollView style={styles.joinModalScroll}>
              <Text style={styles.joinModalRules}>{rulesJoinTarget?.rules ?? ""}</Text>
            </ScrollView>
            <Text style={styles.joinModalHint}>You must agree to the rules to join.</Text>
            <View style={styles.joinModalActions}>
              <Pressable style={styles.joinModalCancel} onPress={() => setRulesJoinTarget(null)}>
                <Text style={styles.joinModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.joinModalAgree, pressed && styles.buttonPressed]}
                onPress={() => rulesJoinTarget && void completeJoin(rulesJoinTarget)}
                disabled={!!joinBusyId}
              >
                {joinBusyId ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.joinModalAgreeText}>I agree</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>

      <Modal visible={showCreate} animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView
          style={styles.createModalRoot}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : 0}
        >
          <View style={[styles.createModalHeader, { paddingTop: Math.max(insets.top, 12) }]}>
            <Text style={styles.createModalHeaderTitle}>Request a new group</Text>
            <Pressable
              onPress={() => {
                setShowCreate(false);
                setCreateName("");
                setCreateDescription("");
                setCreateCategory("");
                setCreateRules("");
                setCreateCoverUrl(null);
                setCreateAllowBusinessPosts(false);
              }}
              hitSlop={12}
            >
              <Text style={styles.createModalClose}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            style={styles.createModalScroll}
            contentContainerStyle={[styles.createModalContent, { paddingBottom: insets.bottom + 24 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Pressable onPress={pickCover} style={styles.coverPicker} disabled={uploadingCover}>
              {createCoverUrl ? (
                <Image source={{ uri: createCoverUrl }} style={styles.coverPickerImage} resizeMode="cover" />
              ) : (
                <View style={styles.coverPickerPlaceholder}>
                  {uploadingCover ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="image-outline" size={32} color={theme.colors.primary} />
                      <Text style={styles.coverPickerText}>Add group photo</Text>
                    </>
                  )}
                </View>
              )}
            </Pressable>
            <TextInput
              style={styles.input}
              placeholder="Group name *"
              placeholderTextColor={theme.colors.placeholder}
              value={createName}
              onChangeText={setCreateName}
              autoCorrect={true}
            />
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Description (optional)"
              placeholderTextColor={theme.colors.placeholder}
              value={createDescription}
              onChangeText={setCreateDescription}
              multiline
              numberOfLines={3}
              autoCorrect={true}
            />
            <TextInput
              style={styles.input}
              placeholder="Category (optional)"
              placeholderTextColor={theme.colors.placeholder}
              value={createCategory}
              onChangeText={setCreateCategory}
              autoCorrect={true}
            />
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Group rules (optional). Members must agree to join."
              placeholderTextColor={theme.colors.placeholder}
              value={createRules}
              onChangeText={setCreateRules}
              multiline
              numberOfLines={4}
              autoCorrect={true}
            />
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleLabel}>Allow businesses to post</Text>
                <Text style={styles.toggleHint}>
                  When on, members can post as a directory business in this group.
                </Text>
              </View>
              <Switch
                value={createAllowBusinessPosts}
                onValueChange={setCreateAllowBusinessPosts}
                trackColor={{ false: "#ccc", true: theme.colors.primary }}
              />
            </View>
            <View style={styles.createActions}>
              <Pressable
                style={({ pressed }) => [styles.cancelBtn, pressed && styles.buttonPressed]}
                onPress={() => {
                  setShowCreate(false);
                  setCreateName("");
                  setCreateDescription("");
                  setCreateCategory("");
                  setCreateRules("");
                  setCreateCoverUrl(null);
                  setCreateAllowBusinessPosts(false);
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.submitBtn, pressed && styles.buttonPressed]}
                onPress={handleCreate}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Submit request</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>

    </>
  );
}

const styles = StyleSheet.create({
  keyboardRoot: { flex: 1, backgroundColor: "#fff" },
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { paddingVertical: 48, alignItems: "center" },
  adminCallout: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 12,
    backgroundColor: "#fff",
    overflow: "hidden",
    marginBottom: 16,
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 0,
  },
  adminCalloutTopBar: {
    alignSelf: "stretch",
    height: 6,
    backgroundColor: theme.colors.primary,
    marginBottom: 16,
  },
  adminCalloutIcon: { marginBottom: 8 },
  adminCalloutTitle: {
    fontSize: 18,
    fontWeight: "700",
    fontFamily: theme.fonts.heading,
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 10,
  },
  adminCalloutBody: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 18,
    maxWidth: 400,
  },
  adminCalloutBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 8,
  },
  adminCalloutBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  searchRow: { marginBottom: 16 },
  searchInput: {
    alignSelf: "stretch",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  joinModalOverlay: {
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  joinModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  joinModalSheet: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    maxHeight: "80%",
  },
  joinModalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 12, color: theme.colors.heading },
  joinModalScroll: { maxHeight: 220, marginBottom: 12 },
  joinModalRules: { fontSize: 15, lineHeight: 22, color: theme.colors.heading },
  joinModalHint: { fontSize: 13, color: theme.colors.placeholder, marginBottom: 16 },
  joinModalActions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
  joinModalCancel: { paddingVertical: 10, paddingHorizontal: 16 },
  joinModalCancelText: { fontSize: 16, color: theme.colors.placeholder },
  joinModalAgree: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    minWidth: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  joinModalAgreeText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  createModalRoot: { flex: 1, backgroundColor: "#fff" },
  createModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
  },
  createModalHeaderTitle: { fontSize: 18, fontWeight: "600", color: theme.colors.heading, flex: 1 },
  createModalClose: { fontSize: 16, color: theme.colors.primary, fontWeight: "600" },
  createModalScroll: { flex: 1 },
  createModalContent: { padding: 16 },
  createCard: {
    backgroundColor: "#f9f9f9",
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  createTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12 },
  coverPicker: { width: "100%", height: 216, marginBottom: 12, borderRadius: 8, overflow: "hidden", borderWidth: 2, borderColor: theme.colors.primary },
  coverPickerImage: { width: "100%", height: "100%" },
  coverPickerPlaceholder: { width: "100%", height: "100%", backgroundColor: theme.colors.cream, alignItems: "center", justifyContent: "center" },
  coverPickerText: { fontSize: 14, color: theme.colors.placeholder, marginTop: 4 },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  inputMultiline: { minHeight: 72, textAlignVertical: "top" },
  filterRow: { marginBottom: 12, maxHeight: 44, flexGrow: 0 },
  filterRowContent: { gap: 8, paddingVertical: 4, alignItems: "center", flexDirection: "row" },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: theme.colors.cream },
  filterChipActive: { backgroundColor: theme.colors.primary },
  filterChipText: { fontSize: 14, color: theme.colors.heading },
  filterChipTextActive: { color: "#fff", fontWeight: "600" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    marginBottom: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
  },
  toggleTextCol: { flex: 1, paddingRight: 12 },
  toggleLabel: { fontSize: 16, fontWeight: "600", color: theme.colors.heading },
  toggleHint: { fontSize: 13, color: "#666", marginTop: 4 },
  createActions: { flexDirection: "row", gap: 8, justifyContent: "flex-end" },
  cancelBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  cancelBtnText: { color: "#666", fontSize: 16 },
  submitBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 6,
  },
  submitBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  buttonPressed: { opacity: 0.8 },
  groupCard: {
    flexDirection: "row",
    marginBottom: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  cover: { width: 80, height: 80 },
  coverPlaceholder: {
    width: 80,
    height: 80,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  groupInfo: { flex: 1, padding: 12, justifyContent: "center" },
  groupName: { fontSize: 16, fontWeight: "600", color: "#333" },
  groupDesc: { fontSize: 13, color: "#666", marginTop: 4 },
  groupMeta: { fontSize: 12, color: "#888", marginTop: 4 },
  joinBtn: {
    alignSelf: "flex-start",
    marginTop: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  joinBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  adminBadge: { fontSize: 12, color: theme.colors.primary, marginTop: 4, fontWeight: "600" },
  emptyText: { fontSize: 14, color: "#888", textAlign: "center", marginTop: 24 },
});
