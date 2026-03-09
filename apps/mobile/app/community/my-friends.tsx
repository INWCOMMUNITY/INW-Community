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

export default function MyFriendsScreen() {
  const router = useRouter();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [suggested, setSuggested] = useState<SuggestedFriend[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Friend[]>([]);
  const [browseMembers, setBrowseMembers] = useState<Friend[]>([]);
  const [friendData, setFriendData] = useState<FriendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);

  const load = useCallback(async () => {
    setBrowseLoading(true);
    apiGet<{ members: Friend[] }>("/api/members?limit=50")
      .then((d) => setBrowseMembers(d?.members ?? []))
      .catch(() => setBrowseMembers([]))
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

  const searchMembers = useCallback(async () => {
    const q = searchQuery.trim();
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
  }, [searchQuery]);

  const addFriend = useCallback(async (addresseeId: string) => {
    await apiPost("/api/friend-requests", { addresseeId });
  }, []);

  const acceptRequest = useCallback(async (requestId: string) => {
    await apiPatch(`/api/friend-requests/${requestId}`, { status: "accepted" });
  }, []);

  const refreshFriendData = useCallback(async () => {
    try {
      const data = await apiGet<FriendData>("/api/friend-requests");
      setFriendData(data ?? null);
    } catch {
      // ignore
    }
  }, []);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
      }
    >
      <View style={styles.searchSection}>
        <Text style={styles.sectionTitle}>Discover members</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search for members..."
            placeholderTextColor={theme.colors.placeholder}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <Pressable
            style={({ pressed }) => [styles.searchBtn, pressed && styles.buttonPressed]}
            onPress={searchMembers}
          >
            {searching ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="search" size={22} color="#fff" />
            )}
          </Pressable>
        </View>
        <Text style={styles.hint}>Search by name (2+ characters) or browse below.</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : (
        <>
          {searchResults.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Search results</Text>
              {searchResults.map((m) => (
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
              ) : browseMembers.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Browse members</Text>
                  {browseMembers.map((m) => (
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

              {suggested.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Recommended (mutual friends)</Text>
                  {suggested.map((s) => (
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
