import { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch } from "@/lib/api";

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
}

interface SuggestedFriend extends Friend {
  mutualCount: number;
}

type FriendStatus = "none" | "friends" | "pending_outgoing" | "pending_incoming";

interface FriendData {
  friends: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null }[];
  incoming: { id: string; requester: Friend }[];
  outgoing: { id: string; addressee: Friend }[];
}

function getFriendStatus(memberId: string, friendData: FriendData | null): FriendStatus {
  if (!friendData) return "none";
  if (friendData.friends.some((f) => f.id === memberId)) return "friends";
  if (friendData.outgoing.some((r) => r.addressee?.id === memberId)) return "pending_outgoing";
  if (friendData.incoming.some((r) => r.requester?.id === memberId)) return "pending_incoming";
  return "none";
}

function getIncomingRequestId(memberId: string, friendData: FriendData | null): string | null {
  if (!friendData) return null;
  const req = friendData.incoming.find((r) => r.requester?.id === memberId);
  return req?.id ?? null;
}

function MemberCard({
  member,
  status,
  incomingRequestId,
  onAddFriend,
  onAccept,
  onRefresh,
  router,
}: {
  member: Friend;
  status: FriendStatus;
  incomingRequestId: string | null;
  onAddFriend: (memberId: string) => Promise<void>;
  onAccept: (requestId: string) => Promise<void>;
  onRefresh: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [loading, setLoading] = useState(false);

  const handleAction = async () => {
    if (status === "friends" || status === "pending_outgoing") return;
    setLoading(true);
    try {
      if (status === "pending_incoming" && incomingRequestId) {
        await onAccept(incomingRequestId);
      } else {
        await onAddFriend(member.id);
      }
      onRefresh();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.friendCard, pressed && styles.buttonPressed]}
      onPress={() => (router.push as (href: string) => void)(`/members/${member.id}`)}
    >
      {member.profilePhotoUrl ? (
        <Image source={{ uri: member.profilePhotoUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>
            {member.firstName?.[0]}
            {member.lastName?.[0]}
          </Text>
        </View>
      )}
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>
          {member.firstName} {member.lastName}
        </Text>
        {member.city && <Text style={styles.friendCity}>{member.city}</Text>}
      </View>
      <View style={styles.actionWrap}>
        {status === "friends" && <Text style={styles.statusLabel}>Friends</Text>}
        {status === "pending_outgoing" && <Text style={styles.statusLabel}>Request sent</Text>}
        {(status === "none" || status === "pending_incoming") && (
          <Pressable
            style={({ pressed }) => [styles.addFriendBtn, pressed && styles.buttonPressed, loading && styles.addFriendBtnDisabled]}
            onPress={(e) => {
              e.stopPropagation();
              handleAction();
            }}
            disabled={loading}
          >
            <Text style={styles.addFriendBtnText}>
              {loading ? "…" : status === "pending_incoming" ? "Accept" : "Add Friend"}
            </Text>
          </Pressable>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color="#999" />
    </Pressable>
  );
}

function IncomingRequestCard({
  request,
  onAccept,
  onDecline,
  onAfterAction,
  router,
}: {
  request: { id: string; requester: Friend };
  onAccept: (requestId: string) => Promise<void>;
  onDecline: (requestId: string) => Promise<void>;
  onAfterAction: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [loading, setLoading] = useState<"accept" | "decline" | null>(null);
  const member = request.requester;

  const run = async (kind: "accept" | "decline") => {
    setLoading(kind);
    try {
      if (kind === "accept") await onAccept(request.id);
      else await onDecline(request.id);
      onAfterAction();
    } finally {
      setLoading(null);
    }
  };

  return (
    <Pressable
      style={({ pressed }) => [styles.incomingRequestCard, pressed && styles.buttonPressed]}
      onPress={() => (router.push as (href: string) => void)(`/members/${member.id}`)}
    >
      {member.profilePhotoUrl ? (
        <Image source={{ uri: member.profilePhotoUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>
            {member.firstName?.[0]}
            {member.lastName?.[0]}
          </Text>
        </View>
      )}
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>
          {member.firstName} {member.lastName}
        </Text>
        {member.city ? <Text style={styles.friendCity}>{member.city}</Text> : null}
      </View>
      <View style={styles.incomingRequestActions}>
        <Pressable
          style={({ pressed }) => [
            styles.incomingAcceptBtn,
            pressed && styles.buttonPressed,
            loading != null && styles.incomingActionDisabled,
          ]}
          onPress={(e) => {
            e.stopPropagation();
            if (!loading) void run("accept");
          }}
          disabled={loading != null}
        >
          {loading === "accept" ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.incomingAcceptBtnText}>Accept</Text>
          )}
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.incomingDeclineBtn,
            pressed && styles.buttonPressed,
            loading != null && styles.incomingActionDisabled,
          ]}
          onPress={(e) => {
            e.stopPropagation();
            if (!loading) void run("decline");
          }}
          disabled={loading != null}
        >
          {loading === "decline" ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
          ) : (
            <Text style={styles.incomingDeclineBtnText}>Decline</Text>
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}

export default function MyFriendsScreen() {
  const router = useRouter();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [suggested, setSuggested] = useState<SuggestedFriend[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Friend[]>([]);
  const [browseMembers, setBrowseMembers] = useState<Friend[]>([]);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [friendData, setFriendData] = useState<FriendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);

  const load = useCallback(async () => {
    setBrowseLoading(true);
    setBrowseError(null);
    apiGet<{ members: Friend[] }>("/api/members?limit=50")
      .then((d) => {
        setBrowseMembers(d?.members ?? []);
        setBrowseError(null);
      })
      .catch((err) => {
        setBrowseMembers([]);
        const msg = (err as { error?: string })?.error ?? "Couldn't load members";
        setBrowseError(msg);
      })
      .finally(() => setBrowseLoading(false));

    const [friendsSettled, suggestedSettled, requestsSettled] = await Promise.allSettled([
      apiGet<{ friends: Friend[] }>("/api/me/friends"),
      apiGet<{ suggested: SuggestedFriend[] }>("/api/me/suggested-friends"),
      apiGet<FriendData>("/api/friend-requests"),
    ]);

    setFriends(
      friendsSettled.status === "fulfilled" ? friendsSettled.value?.friends ?? [] : []
    );
    setSuggested(
      suggestedSettled.status === "fulfilled" ? suggestedSettled.value?.suggested ?? [] : []
    );
    setFriendData(
      requestsSettled.status === "fulfilled" ? requestsSettled.value ?? null : null
    );

    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const searchMembers = useCallback(async (query: string) => {
    const q = query.trim();
    if (!q || q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const data = await apiGet<{ members: Friend[] }>(
        `/api/members?q=${encodeURIComponent(q)}&limit=30`
      );
      setSearchResults(data?.members ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => {
      searchMembers(q);
      debounceRef.current = null;
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, searchMembers]);

  const addFriend = useCallback(async (addresseeId: string) => {
    await apiPost("/api/friend-requests", { addresseeId });
  }, []);

  const acceptRequest = useCallback(async (requestId: string) => {
    await apiPatch(`/api/friend-requests/${requestId}`, { status: "accepted" });
  }, []);

  const declineRequest = useCallback(async (requestId: string) => {
    await apiPatch(`/api/friend-requests/${requestId}`, { status: "declined" });
  }, []);

  const refreshFriendData = useCallback(async () => {
    try {
      const data = await apiGet<FriendData>("/api/friend-requests");
      setFriendData(data ?? null);
    } catch {
      // ignore
    }
  }, []);

  const incomingRequesterIds = useMemo(() => {
    const ids =
      friendData?.incoming.map((r) => r.requester?.id).filter((id): id is string => !!id) ?? [];
    return new Set(ids);
  }, [friendData]);

  const browseMembersFiltered = useMemo(
    () => browseMembers.filter((m) => !incomingRequesterIds.has(m.id)),
    [browseMembers, incomingRequesterIds]
  );

  const searchResultsFiltered = useMemo(
    () => searchResults.filter((m) => !incomingRequesterIds.has(m.id)),
    [searchResults, incomingRequesterIds]
  );

  const suggestedFiltered = useMemo(
    () => suggested.filter((s) => !incomingRequesterIds.has(s.id)),
    [suggested, incomingRequesterIds]
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
      }
    >
      <View style={[styles.section, styles.friendRequestsSection]}>
        <Text style={styles.sectionTitle}>Friend requests</Text>
        {loading ? (
          <View style={styles.friendRequestsLoading}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
          </View>
        ) : friendData && friendData.incoming.length > 0 ? (
          friendData.incoming.map((req) => (
            <IncomingRequestCard
              key={req.id}
              request={req}
              onAccept={acceptRequest}
              onDecline={declineRequest}
              onAfterAction={load}
              router={router}
            />
          ))
        ) : (
          <Text style={styles.emptyText}>No pending friend requests.</Text>
        )}
      </View>

      <View style={styles.searchSection}>
        <Text style={styles.sectionTitle}>Discover members</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search for members..."
            placeholderTextColor={theme.colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCorrect={true}
          />
          {searching ? (
            <View style={styles.searchBtn}>
              <ActivityIndicator size="small" color="#fff" />
            </View>
          ) : (
            <View style={styles.searchIconOnly}>
              <Ionicons name="search" size={22} color="#999" />
            </View>
          )}
        </View>
        <Text style={styles.hint}>Search by name (2+ characters) or browse below.</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <>
          {searchResultsFiltered.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Search results</Text>
              {searchResultsFiltered.map((m) => (
                <MemberCard
                  key={m.id}
                  member={m}
                  status={getFriendStatus(m.id, friendData)}
                  incomingRequestId={getIncomingRequestId(m.id, friendData)}
                  onAddFriend={addFriend}
                  onAccept={acceptRequest}
                  onRefresh={refreshFriendData}
                  router={router}
                />
              ))}
            </View>
          )}

          {!searchQuery.trim() && (
            <>
              {browseLoading ? (
                <View style={styles.center}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                </View>
              ) : browseError ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Browse members</Text>
                  <Text style={styles.emptyText}>{browseError}</Text>
                </View>
              ) : browseMembersFiltered.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Browse members</Text>
                  {browseMembersFiltered.map((m) => (
                    <MemberCard
                      key={m.id}
                      member={m}
                      status={getFriendStatus(m.id, friendData)}
                      incomingRequestId={getIncomingRequestId(m.id, friendData)}
                      onAddFriend={addFriend}
                      onAccept={acceptRequest}
                      onRefresh={refreshFriendData}
                      router={router}
                    />
                  ))}
                </View>
              ) : null}

              {suggestedFiltered.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Recommended (mutual friends)</Text>
                  {suggestedFiltered.map((s) => (
                    <MemberCard
                      key={s.id}
                      member={s}
                      status={getFriendStatus(s.id, friendData)}
                      incomingRequestId={getIncomingRequestId(s.id, friendData)}
                      onAddFriend={addFriend}
                      onAccept={acceptRequest}
                      onRefresh={refreshFriendData}
                      router={router}
                    />
                  ))}
                </View>
              )}
            </>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>My Friends ({friends.length})</Text>
            {friends.length === 0 ? (
              <Text style={styles.emptyText}>
                No friends yet. Search or browse members above to add friends.
              </Text>
            ) : (
              friends.map((f) => (
                <Pressable
                  key={f.id}
                  style={({ pressed }) => [styles.friendCard, pressed && styles.buttonPressed]}
                  onPress={() => (router.push as (href: string) => void)(`/members/${f.id}`)}
                >
                  {f.profilePhotoUrl ? (
                    <Image source={{ uri: f.profilePhotoUrl }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Text style={styles.avatarText}>
                        {f.firstName?.[0]}
                        {f.lastName?.[0]}
                      </Text>
                    </View>
                  )}
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>
                      {f.firstName} {f.lastName}
                    </Text>
                    {f.city && <Text style={styles.friendCity}>{f.city}</Text>}
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#999" />
                </Pressable>
              ))
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { paddingVertical: 24, alignItems: "center" },
  searchSection: { marginBottom: 24 },
  section: { marginBottom: 24 },
  friendRequestsSection: {
    paddingBottom: 16,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e8e8e8",
  },
  friendRequestsLoading: {
    paddingVertical: 16,
    alignItems: "flex-start",
  },
  incomingRequestCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#f5faf6",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  incomingRequestActions: { flexDirection: "row", gap: 6, marginLeft: 2 },
  incomingAcceptBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: theme.colors.primary,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  incomingAcceptBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  incomingDeclineBtn: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  incomingDeclineBtnText: { color: theme.colors.primary, fontSize: 12, fontWeight: "600" },
  incomingActionDisabled: { opacity: 0.65 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: {
    flex: 1,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 16,
  },
  searchBtn: {
    backgroundColor: theme.colors.primary,
    padding: 12,
    borderRadius: 8,
    justifyContent: "center",
    minWidth: 48,
  },
  searchIconOnly: {
    padding: 12,
    justifyContent: "center",
    minWidth: 48,
    alignItems: "center",
  },
  hint: { fontSize: 12, color: "#666", marginTop: 8 },
  buttonPressed: { opacity: 0.8 },
  friendCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 16, fontWeight: "600", color: theme.colors.primary },
  friendInfo: { flex: 1, marginLeft: 12 },
  friendName: { fontSize: 16, fontWeight: "600", color: "#333" },
  friendCity: { fontSize: 13, color: "#666", marginTop: 2 },
  actionWrap: { marginRight: 8 },
  statusLabel: { fontSize: 12, color: "#666" },
  addFriendBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  addFriendBtnDisabled: { opacity: 0.7 },
  addFriendBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  mutualHint: { fontSize: 11, color: "#888", marginTop: 4 },
  emptyText: { fontSize: 14, color: "#888", marginTop: 8 },
});
