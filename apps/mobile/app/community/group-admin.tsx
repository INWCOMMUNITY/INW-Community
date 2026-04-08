import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Modal,
  Switch,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api";

type Tab = "members" | "flagged" | "settings";

interface AdminGroup {
  id: string;
  name: string;
  slug: string;
}

interface Overview {
  slug: string;
  name: string;
  isCreator: boolean;
  pendingDeletionRequest: { id: string; createdAt: string } | null;
}

interface MemberRow {
  id: string;
  memberId: string;
  role: string;
  joinedAt: string;
  isCreator: boolean;
  member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
}

interface ReportRow {
  id: string;
  contentId: string;
  reason: string;
  details: string | null;
  createdAt: string;
  reporter: { id: string; firstName: string; lastName: string };
  post: { id: string; content: string | null; createdAt: string } | null;
}

export default function GroupAdminScreen() {
  const { slug: slugParam } = useLocalSearchParams<{ slug?: string }>();
  const router = useRouter();
  const navigation = useNavigation();

  const [adminGroups, setAdminGroups] = useState<AdminGroup[]>([]);
  const [slug, setSlug] = useState<string>(slugParam ?? "");
  const [tab, setTab] = useState<Tab>("members");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [rules, setRules] = useState("");
  const [allowBiz, setAllowBiz] = useState(false);
  const [inviteId, setInviteId] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);
  const [requestingDel, setRequestingDel] = useState(false);

  const loadAdminGroups = useCallback(async () => {
    try {
      const data = await apiGet<{ groups: AdminGroup[] }>("/api/me/groups?scope=admin");
      const list = data?.groups ?? [];
      setAdminGroups(list);
      const preferred =
        typeof slugParam === "string" && slugParam.trim() ? slugParam.trim() : null;
      setSlug((prev) => {
        if (preferred && list.some((g) => g.slug === preferred)) return preferred;
        if (prev && list.some((g) => g.slug === prev)) return prev;
        return list[0]?.slug ?? prev ?? "";
      });
    } catch {
      setAdminGroups([]);
    }
  }, [slugParam]);

  const loadTabData = useCallback(async () => {
    if (!slug) {
      setOverview(null);
      setMembers([]);
      setReports([]);
      return;
    }
    try {
      const [ov, mem, rep, grp] = await Promise.all([
        apiGet<Overview>(`/api/groups/${slug}/admin/overview`),
        apiGet<{ members: MemberRow[] }>(`/api/groups/${slug}/admin/members?limit=100`),
        apiGet<{ reports: ReportRow[] }>(`/api/groups/${slug}/admin/reported-posts`),
        apiGet<{ rules: string | null; allowBusinessPosts?: boolean }>(`/api/groups/${slug}`),
      ]);
      setOverview(ov && !(ov as { error?: string }).error ? ov : null);
      setMembers(mem?.members ?? []);
      setReports(rep?.reports ?? []);
      if (grp && !(grp as { error?: string }).error) {
        setRules((grp as { rules?: string | null }).rules ?? "");
        setAllowBiz(!!(grp as { allowBusinessPosts?: boolean }).allowBusinessPosts);
      }
    } catch {
      setOverview(null);
    }
  }, [slug]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await loadAdminGroups();
    await loadTabData();
    setRefreshing(false);
  }, [loadAdminGroups, loadTabData]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setLoading(true);
        await loadAdminGroups();
        setLoading(false);
      })();
    }, [loadAdminGroups])
  );

  useEffect(() => {
    if (!slug) return;
    void loadTabData();
  }, [slug, loadTabData]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: overview?.name ?? "Group admin",
      headerRight: () => (
        <Pressable
          onPress={() => setPickerOpen(true)}
          hitSlop={12}
          style={({ pressed }) => [{ paddingHorizontal: 8, opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="chevron-down-circle" size={26} color="#fff" />
        </Pressable>
      ),
    });
  }, [navigation, overview?.name]);

  const removeMember = (m: MemberRow) => {
    if (m.isCreator) return;
    Alert.alert(
      "Remove member",
      `${m.member.firstName} ${m.member.lastName} will not be able to rejoin or find this group.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await apiPost(`/api/groups/${slug}/admin/members/${m.memberId}/remove`);
              setMembers((prev) => prev.filter((x) => x.memberId !== m.memberId));
            } catch (e) {
              Alert.alert("Error", (e as { error?: string })?.error ?? "Failed");
            }
          },
        },
      ]
    );
  };

  const deleteReportedPost = (postId: string) => {
    Alert.alert("Delete post", "Remove this post from the group?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await apiDelete(`/api/posts/${postId}`);
            setReports((prev) => prev.filter((r) => r.contentId !== postId));
          } catch (e) {
            Alert.alert("Error", (e as { error?: string })?.error ?? "Failed");
          }
        },
      },
    ]);
  };

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await apiPatch(`/api/groups/${slug}`, {
        rules: rules.trim() || null,
        allowBusinessPosts: allowBiz,
      });
      Alert.alert("Saved", "Group settings updated.");
    } catch (e) {
      Alert.alert("Error", (e as { error?: string })?.error ?? "Failed to save");
    } finally {
      setSavingSettings(false);
    }
  };

  const sendInvite = async () => {
    const id = inviteId.trim();
    if (!id) {
      Alert.alert("Invite", "Enter the member ID to invite as co-admin.");
      return;
    }
    try {
      await apiPost(`/api/groups/${slug}/invite-admin`, { inviteeId: id });
      setInviteId("");
      Alert.alert("Sent", "An invite was sent. They will also get a message with a link to accept.");
    } catch (e) {
      Alert.alert("Error", (e as { error?: string })?.error ?? "Failed");
    }
  };

  const requestDeletion = async () => {
    setRequestingDel(true);
    try {
      await apiPost(`/api/groups/${slug}/request-deletion`, {});
      Alert.alert("Requested", "Northwest Community will review your request to delete this group.");
      await loadTabData();
    } catch (e) {
      Alert.alert("Error", (e as { error?: string })?.error ?? "Failed");
    } finally {
      setRequestingDel(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (adminGroups.length === 0) {
    return (
      <View style={styles.centerPad}>
        <Text style={styles.muted}>You are not an admin of any group.</Text>
        <Pressable style={styles.linkBtn} onPress={() => router.back()}>
          <Text style={styles.linkBtnText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!slug) {
    return (
      <View style={styles.centerPad}>
        <Text style={styles.muted}>Select a group.</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        {(["members", "flagged", "settings"] as const).map((t) => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === "members" ? "Members" : t === "flagged" ? "Flagged" : "Settings"}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} colors={[theme.colors.primary]} />
        }
      >
        {tab === "members" && (
          <View>
            {members.length === 0 ? (
              <Text style={styles.muted}>No members.</Text>
            ) : (
              members.map((m) => (
                <View key={m.id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>
                      {m.member.firstName} {m.member.lastName}
                      {m.isCreator ? " (creator)" : ""}
                      {m.role === "admin" && !m.isCreator ? " · admin" : ""}
                    </Text>
                  </View>
                  {!m.isCreator && (
                    <Pressable onPress={() => removeMember(m)} style={styles.dangerBtn}>
                      <Text style={styles.dangerBtnText}>Remove</Text>
                    </Pressable>
                  )}
                </View>
              ))
            )}
          </View>
        )}

        {tab === "flagged" && (
          <View>
            {reports.length === 0 ? (
              <Text style={styles.muted}>No pending reports for posts in this group.</Text>
            ) : (
              reports.map((r) => (
                <View key={r.id} style={styles.card}>
                  <Text style={styles.cardMeta}>
                    {r.reason} · {new Date(r.createdAt).toLocaleString()}
                  </Text>
                  <Text style={styles.cardMeta}>
                    Reported by {r.reporter.firstName} {r.reporter.lastName}
                  </Text>
                  {r.post?.content ? (
                    <Text style={styles.cardBody} numberOfLines={4}>
                      {r.post.content}
                    </Text>
                  ) : null}
                  {r.details ? <Text style={styles.cardHint}>{r.details}</Text> : null}
                  {r.post?.id ? (
                    <Pressable style={styles.dangerBtn} onPress={() => deleteReportedPost(r.post!.id)}>
                      <Text style={styles.dangerBtnText}>Delete post</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))
            )}
          </View>
        )}

        {tab === "settings" && (
          <View>
            <Text style={styles.label}>Group rules</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={rules}
              onChangeText={setRules}
              placeholder="Rules members agree to when joining"
              placeholderTextColor={theme.colors.placeholder}
              multiline
            />
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>Allow businesses to post</Text>
              <Switch value={allowBiz} onValueChange={setAllowBiz} trackColor={{ false: "#ccc", true: theme.colors.primary }} />
            </View>
            <Pressable
              style={[styles.primaryBtn, savingSettings && styles.btnDisabled]}
              disabled={savingSettings}
              onPress={() => void saveSettings()}
            >
              <Text style={styles.primaryBtnText}>{savingSettings ? "Saving…" : "Save settings"}</Text>
            </Pressable>

            <Text style={[styles.label, { marginTop: 24 }]}>Invite co-admin</Text>
            <Text style={styles.hint}>Enter member ID. They must be a member; they will get a DM with a link.</Text>
            <TextInput
              style={styles.input}
              value={inviteId}
              onChangeText={setInviteId}
              placeholder="Member ID"
              placeholderTextColor={theme.colors.placeholder}
              autoCapitalize="none"
            />
            <Pressable style={styles.primaryBtn} onPress={() => void sendInvite()}>
              <Text style={styles.primaryBtnText}>Send invite</Text>
            </Pressable>

            {overview?.isCreator && (
              <>
                <Text style={[styles.label, { marginTop: 24 }]}>Delete group</Text>
                {overview.pendingDeletionRequest ? (
                  <Text style={styles.hint}>A deletion request is pending site review.</Text>
                ) : (
                  <>
                    <Text style={styles.hint}>
                      Only you can request deletion. Co-admins cannot. Northwest Community must approve before the group is
                      removed.
                    </Text>
                    <Pressable
                      style={[styles.dangerOutline, requestingDel && styles.btnDisabled]}
                      disabled={requestingDel}
                      onPress={() => void requestDeletion()}
                    >
                      <Text style={styles.dangerOutlineText}>{requestingDel ? "Sending…" : "Request deletion"}</Text>
                    </Pressable>
                  </>
                )}
              </>
            )}
          </View>
        )}
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)} />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Switch group</Text>
          <ScrollView style={{ maxHeight: 320 }}>
            {adminGroups.map((g) => (
              <Pressable
                key={g.id}
                style={[styles.pickerRow, g.slug === slug && styles.pickerRowActive]}
                onPress={() => {
                  setSlug(g.slug);
                  setPickerOpen(false);
                }}
              >
                <Text style={styles.pickerRowText}>{g.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable style={styles.modalClose} onPress={() => setPickerOpen(false)}>
            <Text style={styles.modalCloseText}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  centerPad: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  muted: { color: theme.colors.placeholder, textAlign: "center" },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e5e5" },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.primary },
  tabText: { fontSize: 14, color: theme.colors.placeholder },
  tabTextActive: { color: theme.colors.primary, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rowTitle: { fontSize: 16, color: theme.colors.heading },
  dangerBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#c00", borderRadius: 6 },
  dangerBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  card: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  cardMeta: { fontSize: 12, color: theme.colors.placeholder, marginBottom: 4 },
  cardBody: { fontSize: 15, color: theme.colors.text, marginVertical: 8 },
  cardHint: { fontSize: 13, color: theme.colors.text, marginBottom: 8 },
  label: { fontSize: 15, fontWeight: "600", color: theme.colors.heading, marginBottom: 8 },
  hint: { fontSize: 13, color: theme.colors.placeholder, marginBottom: 8 },
  input: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 12,
  },
  inputMultiline: { minHeight: 100, textAlignVertical: "top" },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  toggleLabel: { flex: 1, fontSize: 15, color: theme.colors.text },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  btnDisabled: { opacity: 0.6 },
  dangerOutline: {
    borderWidth: 2,
    borderColor: "#c00",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  dangerOutlineText: { color: "#c00", fontWeight: "600", fontSize: 16 },
  linkBtn: { marginTop: 16 },
  linkBtnText: { color: theme.colors.primary, fontSize: 16, fontWeight: "600" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" },
  modalSheet: {
    position: "absolute",
    left: 24,
    right: 24,
    top: "25%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    maxHeight: "60%",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12, color: theme.colors.heading },
  pickerRow: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#eee" },
  pickerRowActive: { backgroundColor: theme.colors.cream },
  pickerRowText: { fontSize: 16, color: theme.colors.text },
  modalClose: { marginTop: 12, alignItems: "center" },
  modalCloseText: { color: theme.colors.primary, fontWeight: "600" },
});
