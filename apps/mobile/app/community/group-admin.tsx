import { useCallback, useEffect, useLayoutEffect, useState, useRef } from "react";
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
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useHeaderHeight } from "@react-navigation/elements";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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

interface FriendRow {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
}

export default function GroupAdminScreen() {
  const { slug: slugParam } = useLocalSearchParams<{ slug?: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const rawHeaderHeight = useHeaderHeight();
  const headerOffset = rawHeaderHeight > 0 ? rawHeaderHeight : 56;
  const insets = useSafeAreaInsets();

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
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [friendQuery, setFriendQuery] = useState("");
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const inviteModalInputRef = useRef<TextInput>(null);
  const [inviteBusyId, setInviteBusyId] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [requestingDel, setRequestingDel] = useState(false);
  const [dismissBusyId, setDismissBusyId] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

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

  useEffect(() => {
    if (tab !== "settings") return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiGet<{ friends: FriendRow[] }>("/api/me/friends");
        if (!cancelled) setFriends(Array.isArray(data?.friends) ? data.friends : []);
      } catch {
        if (!cancelled) setFriends([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const subShow = Keyboard.addListener(showEvt, (e) => setKeyboardHeight(e.endCoordinates.height));
    const subHide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  useEffect(() => {
    if (!inviteSheetOpen) return;
    const t = setTimeout(() => inviteModalInputRef.current?.focus(), 200);
    return () => clearTimeout(t);
  }, [inviteSheetOpen]);

  const closeInviteSheet = useCallback(() => {
    setInviteSheetOpen(false);
    Keyboard.dismiss();
    inviteModalInputRef.current?.blur();
  }, []);

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

  const dismissReport = (reportId: string) => {
    setDismissBusyId(reportId);
    void (async () => {
      try {
        await apiPost(`/api/groups/${slug}/admin/reports/${reportId}/dismiss`, {});
        setReports((prev) => prev.filter((r) => r.id !== reportId));
      } catch (e) {
        Alert.alert("Error", (e as { error?: string })?.error ?? "Failed to dismiss");
      } finally {
        setDismissBusyId(null);
      }
    })();
  };

  const openReportedPost = (postId: string) => {
    router.push(`/post/${postId}`);
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

  const inviteFriend = async (friendId: string) => {
    setInviteBusyId(friendId);
    try {
      await apiPost(`/api/groups/${slug}/invite-admin`, { inviteeId: friendId });
      setFriendQuery("");
      closeInviteSheet();
      Alert.alert(
        "Sent",
        "They can accept or decline from the site banner or the message link. They are not co-admin until they accept."
      );
    } catch (e) {
      Alert.alert("Error", (e as { error?: string })?.error ?? "Failed");
    } finally {
      setInviteBusyId(null);
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

  const adminMemberIds = new Set(
    members.filter((m) => m.isCreator || m.role === "admin").map((m) => m.memberId)
  );
  const friendSearchQ = friendQuery.trim().toLowerCase();
  const filteredFriends =
    friendSearchQ.length >= 1
      ? friends.filter((f) => `${f.firstName} ${f.lastName}`.toLowerCase().includes(friendSearchQ))
      : [];

  const scrollBottomPad = 40 + keyboardHeight;

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

      <KeyboardAvoidingView
        style={styles.keyboardFlex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={headerOffset}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: scrollBottomPad }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
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
                  {r.post?.id ? (
                    <Pressable
                      onPress={() => openReportedPost(r.post!.id)}
                      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
                    >
                      {r.post?.content ? (
                        <Text style={styles.cardBody} numberOfLines={4}>
                          {r.post.content}
                        </Text>
                      ) : (
                        <Text style={[styles.cardBody, styles.tapHint]}>(No text in preview — open for full post)</Text>
                      )}
                      <Text style={styles.tapHint}>Tap to view full post</Text>
                    </Pressable>
                  ) : r.post?.content ? (
                    <Text style={styles.cardBody} numberOfLines={4}>
                      {r.post.content}
                    </Text>
                  ) : null}
                  {r.details ? <Text style={styles.cardHint}>{r.details}</Text> : null}
                  <View style={styles.cardActions}>
                    {r.post?.id ? (
                      <Pressable style={styles.secondaryBtn} onPress={() => openReportedPost(r.post!.id)}>
                        <Text style={styles.secondaryBtnText}>View</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      style={[styles.secondaryBtn, dismissBusyId === r.id && styles.btnDisabled]}
                      disabled={dismissBusyId === r.id}
                      onPress={() => dismissReport(r.id)}
                    >
                      <Text style={styles.secondaryBtnText}>
                        {dismissBusyId === r.id ? "…" : "Dismiss"}
                      </Text>
                    </Pressable>
                    {r.post?.id ? (
                      <Pressable style={styles.dangerBtn} onPress={() => deleteReportedPost(r.post!.id)}>
                        <Text style={styles.dangerBtnText}>Delete</Text>
                      </Pressable>
                    ) : null}
                  </View>
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
            <Text style={styles.hint}>
              Open search, type a name, then tap Invite. They must accept or decline before becoming co-admin.
            </Text>
            <Pressable
              style={styles.inviteSearchTrigger}
              onPress={() => setInviteSheetOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Search friends to invite as co-admin"
            >
              <Text
                style={friendQuery.trim() ? styles.inviteSearchTriggerText : styles.inviteSearchTriggerPlaceholder}
                numberOfLines={1}
              >
                {friendQuery.trim() ? friendQuery : "Tap to search friends…"}
              </Text>
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
      </KeyboardAvoidingView>

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

      <Modal
        visible={inviteSheetOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closeInviteSheet}
      >
        <KeyboardAvoidingView
          style={styles.inviteModalOuter}
          behavior={Platform.OS === "ios" ? "padding" : "padding"}
          keyboardVerticalOffset={0}
        >
          <View style={styles.inviteModalInner}>
            <Pressable style={styles.inviteModalBackdrop} onPress={closeInviteSheet} accessibilityLabel="Close" />
            <View style={[styles.inviteModalCard, { paddingBottom: Math.max(insets.bottom, 12) + 12 }]}>
              <View style={styles.inviteModalHeaderRow}>
                <Text style={styles.inviteModalTitle}>Invite co-admin</Text>
                <Pressable onPress={closeInviteSheet} hitSlop={12} accessibilityRole="button" accessibilityLabel="Done">
                  <Text style={styles.inviteModalDone}>Done</Text>
                </Pressable>
              </View>
              <TextInput
                ref={inviteModalInputRef}
                style={styles.input}
                value={friendQuery}
                onChangeText={setFriendQuery}
                placeholder="Start typing a name…"
                placeholderTextColor={theme.colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <ScrollView
                style={styles.inviteModalScroll}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
                {friendSearchQ.length < 1 ? (
                  <Text style={styles.inviteModalListHint}>Type at least one letter to filter friends.</Text>
                ) : filteredFriends.length === 0 ? (
                  <Text style={styles.friendDropdownEmpty}>No matching friends.</Text>
                ) : (
                  filteredFriends.map((f) => {
                    const already = adminMemberIds.has(f.id);
                    const busy = inviteBusyId === f.id;
                    return (
                      <View key={f.id} style={styles.friendRow}>
                        <View style={styles.friendRowNameCell}>
                          <Text style={styles.friendRowText} numberOfLines={2}>
                            {f.firstName} {f.lastName}
                            {f.city ? ` · ${f.city}` : ""}
                          </Text>
                        </View>
                        <View style={styles.friendRowDivider} />
                        <View style={styles.friendRowActionCell}>
                          {already ? (
                            <Text style={styles.friendRowMuted}>Admin</Text>
                          ) : (
                            <Pressable
                              style={[styles.friendRowInviteBtn, busy && styles.btnDisabled]}
                              disabled={busy}
                              onPress={() => void inviteFriend(f.id)}
                            >
                              <Text style={styles.friendRowInviteBtnText}>{busy ? "…" : "Invite"}</Text>
                            </Pressable>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  keyboardFlex: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  centerPad: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  muted: { color: theme.colors.placeholder, textAlign: "center" },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e5e5" },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: theme.colors.primary },
  tabText: { fontSize: 14, color: theme.colors.placeholder },
  tabTextActive: { color: theme.colors.primary, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { padding: 16 },
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
  tapHint: { fontSize: 12, color: theme.colors.primary, marginBottom: 6, fontWeight: "600" },
  cardActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  secondaryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  secondaryBtnText: { color: theme.colors.primary, fontWeight: "600", fontSize: 13 },
  inviteSearchTrigger: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    justifyContent: "center",
    minHeight: 48,
  },
  inviteSearchTriggerText: { fontSize: 16, color: theme.colors.text },
  inviteSearchTriggerPlaceholder: { fontSize: 16, color: theme.colors.placeholder },
  inviteModalOuter: { flex: 1 },
  inviteModalInner: { flex: 1, justifyContent: "flex-end" },
  inviteModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)" },
  inviteModalCard: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    maxHeight: "78%",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: "#ccc",
  },
  inviteModalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  inviteModalTitle: { fontSize: 18, fontWeight: "700", color: theme.colors.heading },
  inviteModalDone: { fontSize: 16, fontWeight: "600", color: theme.colors.primary },
  inviteModalScroll: { flexGrow: 0, maxHeight: 340 },
  inviteModalListHint: { fontSize: 14, color: theme.colors.placeholder, paddingVertical: 12 },
  friendDropdownEmpty: {
    fontSize: 13,
    color: theme.colors.placeholder,
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  friendRow: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ccc",
  },
  friendRowNameCell: {
    flex: 1,
    justifyContent: "center",
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
  },
  friendRowDivider: {
    width: 1,
    backgroundColor: "#9e9e9e",
  },
  friendRowActionCell: {
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 100,
  },
  friendRowText: { fontSize: 15, color: theme.colors.text },
  friendRowMuted: { fontSize: 13, color: theme.colors.placeholder, textAlign: "center" },
  friendRowInviteBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    minWidth: 88,
    alignItems: "center",
  },
  friendRowInviteBtnText: { color: theme.colors.primary, fontWeight: "700", fontSize: 14 },
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
