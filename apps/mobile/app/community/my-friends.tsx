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
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiPatch } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { initialsAvatarColor } from "@/lib/initials-avatar";

interface Friend {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  city: string | null;
  bio?: string | null;
  friendsSince?: string;
}

interface SuggestedFriend extends Friend {
  mutualCount: number;
  reasons?: string[];
}

type FriendStatus = "none" | "friends" | "pending_outgoing" | "pending_incoming";
type Tab = "friends" | "requests" | "discover";
type FriendSortOption = "all" | "nearby" | "alphabetical" | "recent";

interface FriendData {
  friends: Friend[];
  incoming: { id: string; requester: Friend }[];
  outgoing: { id: string; addressee: Friend }[];
}

function fullName(m: { firstName: string; lastName: string }) {
  return `${m.firstName} ${m.lastName}`.trim();
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

function Avatar({ person, size = 52 }: { person: Friend; size?: number }) {
  const name = fullName(person);
  if (person.profilePhotoUrl) {
    return (
      <Image
        source={{ uri: person.profilePhotoUrl }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: theme.colors.primary,
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: initialsAvatarColor(name),
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 2,
        borderColor: theme.colors.primary,
      }}
    >
      <Text style={{ fontSize: size * 0.32, fontWeight: "700", color: "#fff" }}>
        {`${person.firstName?.[0] ?? ""}${person.lastName?.[0] ?? ""}`.toUpperCase()}
      </Text>
    </View>
  );
}

function CityChip({ city }: { city?: string | null }) {
  if (!city) return null;
  return (
    <View style={styles.cityChip}>
      <Text style={styles.cityChipText}>{city}</Text>
    </View>
  );
}

function MemberCard({
  member,
  status,
  incomingRequestId,
  reasons,
  onAddFriend,
  onAccept,
  onRefresh,
  router,
}: {
  member: Friend;
  status: FriendStatus;
  incomingRequestId: string | null;
  reasons?: string[];
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
      style={({ pressed }) => [styles.discoverCard, pressed && styles.buttonPressed]}
      onPress={() => (router.push as (href: string) => void)(`/members/${member.id}`)}
    >
      <Avatar person={member} size={64} />
      <Text style={styles.discoverName} numberOfLines={2}>
        {fullName(member)}
      </Text>
      <CityChip city={member.city} />
      {reasons && reasons.length > 0 ? (
        <Text style={styles.reasonText} numberOfLines={2}>
          {reasons.join(" · ")}
        </Text>
      ) : null}
      <View style={styles.discoverAction}>
        {status === "friends" && <Text style={styles.statusLabel}>Friends</Text>}
        {status === "pending_outgoing" && <Text style={styles.statusLabel}>Request sent</Text>}
        {(status === "none" || status === "pending_incoming") && (
          <Pressable
            style={({ pressed }) => [
              styles.addFriendBtn,
              pressed && styles.buttonPressed,
              loading && styles.addFriendBtnDisabled,
            ]}
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
      <Avatar person={member} size={52} />
      <View style={styles.friendInfo}>
        <Text style={styles.friendName}>{fullName(member)}</Text>
        <CityChip city={member.city} />
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
  const { member: me } = useAuth();
  const [tab, setTab] = useState<Tab>("friends");
  const tabSeededRef = useRef(false);
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
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [friendSort, setFriendSort] = useState<FriendSortOption>("all");

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

    const nextFriends =
      friendsSettled.status === "fulfilled" ? friendsSettled.value?.friends ?? [] : [];
    const nextRequests =
      requestsSettled.status === "fulfilled" ? requestsSettled.value ?? null : null;
    setFriends(nextFriends);
    setSuggested(
      suggestedSettled.status === "fulfilled" ? suggestedSettled.value?.suggested ?? [] : []
    );
    setFriendData(nextRequests);

    if (!tabSeededRef.current && (nextRequests?.incoming.length ?? 0) > 0) {
      setTab("requests");
    }
    tabSeededRef.current = true;
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
      const [data, friendsData] = await Promise.all([
        apiGet<FriendData>("/api/friend-requests"),
        apiGet<{ friends: Friend[] }>("/api/me/friends"),
      ]);
      setFriendData(data ?? null);
      setFriends(friendsData?.friends ?? []);
    } catch {
      // ignore
    }
  }, []);

  const unfriend = useCallback((person: Friend) => {
    Alert.alert("Unfriend", `Unfriend ${fullName(person)}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unfriend",
        style: "destructive",
        onPress: async () => {
          try {
            await apiPost(`/api/members/${person.id}/unfriend`, {});
            setFriends((prev) => prev.filter((f) => f.id !== person.id));
            setFriendData((prev) =>
              prev ? { ...prev, friends: prev.friends.filter((f) => f.id !== person.id) } : prev
            );
          } catch {
            Alert.alert("Error", "Could not unfriend this member.");
          }
        },
      },
    ]);
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

  const myCityKey = me?.city?.toLowerCase().trim() || null;

  const friendsFiltered = useMemo(() => {
    let list = [...friends];
    const q = friendSearchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((f) => {
        const name = fullName(f).toLowerCase();
        return name.includes(q) || (f.city ?? "").toLowerCase().includes(q);
      });
    }
    if (friendSort === "nearby" && myCityKey) {
      list = list.filter((f) => (f.city ?? "").toLowerCase().trim() === myCityKey);
    }
    if (friendSort === "recent") {
      list.sort((a, b) => {
        const ta = a.friendsSince ? new Date(a.friendsSince).getTime() : 0;
        const tb = b.friendsSince ? new Date(b.friendsSince).getTime() : 0;
        return tb - ta;
      });
    } else {
      list.sort((a, b) => fullName(a).localeCompare(fullName(b)));
    }
    return list;
  }, [friends, friendSearchQuery, friendSort, myCityKey]);

  const requestCount = friendData?.incoming.length ?? 0;

  const renderFriendRow = (f: Friend) => {
    return (
      <View key={f.id} style={styles.friendCard}>
        <Pressable
          style={({ pressed }) => [styles.friendCardMain, pressed && styles.buttonPressed]}
          onPress={() => (router.push as (href: string) => void)(`/members/${f.id}`)}
        >
          <Avatar person={f} />
          <View style={styles.friendInfo}>
            <Text style={styles.friendName}>{fullName(f)}</Text>
            <CityChip city={f.city} />
          </View>
        </Pressable>
        <View style={styles.friendActions}>
          <Pressable
            style={({ pressed }) => [styles.messageBtn, pressed && styles.buttonPressed]}
            onPress={() =>
              (router.push as (href: string) => void)(
                `/messages/new?addresseeId=${encodeURIComponent(f.id)}`
              )
            }
          >
            <Ionicons name="chatbubble-outline" size={16} color="#fff" />
            <Text style={styles.messageBtnText}>Message</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.unfriendBtn, pressed && styles.buttonPressed]}
            onPress={() => unfriend(f)}
          >
            <Text style={styles.unfriendBtnText}>Unfriend</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
      }
    >
      <View style={styles.tabRow}>
        {(
          [
            ["friends", `Friends (${friends.length})`],
            ["requests", "Requests"],
            ["discover", "Discover"],
          ] as const
        ).map(([key, label]) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              style={[styles.tabBtn, active && styles.tabBtnActive]}
            >
              <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>{label}</Text>
              {key === "requests" && requestCount > 0 ? (
                <View style={[styles.tabBadge, active && styles.tabBadgeOnActive]}>
                  <Text style={[styles.tabBadgeText, active && styles.tabBadgeTextOnActive]}>
                    {requestCount > 99 ? "99+" : String(requestCount)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {tab === "friends" && (
        <>
          <View style={styles.friendsControls}>
            <TextInput
              style={styles.friendSearchInput}
              placeholder="Search friends..."
              placeholderTextColor="#999"
              value={friendSearchQuery}
              onChangeText={setFriendSearchQuery}
            />
            <View style={styles.sortRow}>
              {(
                [
                  ["all", "All"],
                  ["nearby", "Near you"],
                  ["alphabetical", "A-Z"],
                  ["recent", "Recent"],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  style={[styles.sortBtn, friendSort === key && styles.sortBtnActive]}
                  onPress={() => setFriendSort(key)}
                >
                  <Text style={[styles.sortBtnText, friendSort === key && styles.sortBtnTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : friends.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color="#ccc" />
              <Text style={styles.emptyStateTitle}>No friends yet</Text>
              <Text style={styles.emptyStateText}>
                Find people you know, or invite someone from the Inland Northwest.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.messageBtn, pressed && styles.buttonPressed]}
                onPress={() => setTab("discover")}
              >
                <Text style={styles.messageBtnText}>Find members</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.inviteOutlineBtn, pressed && styles.buttonPressed]}
                onPress={() => router.push("/share-inw-community" as never)}
              >
                <Text style={styles.inviteOutlineBtnText}>Invite to NWC</Text>
              </Pressable>
            </View>
          ) : friendsFiltered.length === 0 ? (
            <Text style={styles.emptyText}>
              {friendSort === "nearby"
                ? me?.city
                  ? `No friends in ${me.city} yet.`
                  : "Add a city to your profile to see nearby friends."
                : `No friends match "${friendSearchQuery}"`}
            </Text>
          ) : (
            <View style={styles.section}>{friendsFiltered.map(renderFriendRow)}</View>
          )}

          {friends.length > 0 ? (
            <Pressable
              style={({ pressed }) => [styles.inviteBanner, pressed && styles.buttonPressed]}
              onPress={() => router.push("/share-inw-community" as never)}
            >
              <Ionicons name="share-social-outline" size={22} color={theme.colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.inviteBannerTitle}>Invite someone from the Inland Northwest</Text>
                <Text style={styles.inviteBannerText}>Share the app so friends can join and connect here.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#999" />
            </Pressable>
          ) : null}
        </>
      )}

      {tab === "requests" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Incoming</Text>
          {loading ? (
            <ActivityIndicator size="small" color={theme.colors.primary} />
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
          {friendData && friendData.outgoing.length > 0 ? (
            <View style={{ marginTop: 20 }}>
              <Text style={styles.sectionTitle}>Sent</Text>
              {friendData.outgoing.map((r) => (
                <Pressable
                  key={r.id}
                  style={({ pressed }) => [styles.outgoingRow, pressed && styles.buttonPressed]}
                  onPress={() =>
                    (router.push as (href: string) => void)(`/members/${r.addressee.id}`)
                  }
                >
                  <Avatar person={r.addressee} size={44} />
                  <View style={styles.friendInfo}>
                    <Text style={styles.friendName}>{fullName(r.addressee)}</Text>
                    <CityChip city={r.addressee.city} />
                  </View>
                  <Text style={styles.statusLabel}>Request sent</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}

      {tab === "discover" && (
        <>
          <View style={styles.searchSection}>
            <Text style={styles.sectionTitle}>Find members</Text>
            <View style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search for members..."
                placeholderTextColor={theme.colors.placeholder}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCorrect
              />
              {searching ? (
                <View style={styles.searchIconOnly}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                </View>
              ) : (
                <View style={styles.searchIconOnly}>
                  <Ionicons name="search" size={22} color="#999" />
                </View>
              )}
            </View>
          </View>

          {searchResultsFiltered.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Search results</Text>
              {searchResultsFiltered.map((m) => {
                const status = getFriendStatus(m.id, friendData);
                const incomingId = getIncomingRequestId(m.id, friendData);
                return (
                  <Pressable
                    key={m.id}
                    style={({ pressed }) => [styles.browseRow, pressed && styles.buttonPressed]}
                    onPress={() => (router.push as (href: string) => void)(`/members/${m.id}`)}
                  >
                    <Avatar person={m} size={44} />
                    <View style={styles.friendInfo}>
                      <Text style={styles.friendName}>{fullName(m)}</Text>
                      <CityChip city={m.city} />
                    </View>
                    {status === "friends" && <Text style={styles.statusLabel}>Friends</Text>}
                    {status === "pending_outgoing" && (
                      <Text style={styles.statusLabel}>Request sent</Text>
                    )}
                    {(status === "none" || status === "pending_incoming") && (
                      <Pressable
                        style={({ pressed }) => [styles.addFriendBtn, pressed && styles.buttonPressed]}
                        onPress={(e) => {
                          e.stopPropagation();
                          if (status === "pending_incoming" && incomingId) {
                            void acceptRequest(incomingId).then(refreshFriendData);
                          } else {
                            void addFriend(m.id).then(refreshFriendData);
                          }
                        }}
                      >
                        <Text style={styles.addFriendBtnText}>
                          {status === "pending_incoming" ? "Accept" : "Add"}
                        </Text>
                      </Pressable>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          {!searchQuery.trim() && (
            <>
              {suggestedFiltered.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>People you may know</Text>
                  <ScrollView
                    horizontal
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.hScroll}
                  >
                    {suggestedFiltered.map((s) => (
                      <MemberCard
                        key={s.id}
                        member={s}
                        status={getFriendStatus(s.id, friendData)}
                        incomingRequestId={getIncomingRequestId(s.id, friendData)}
                        reasons={
                          s.reasons?.length
                            ? s.reasons
                            : s.mutualCount
                              ? [`${s.mutualCount} mutual friend${s.mutualCount !== 1 ? "s" : ""}`]
                              : undefined
                        }
                        onAddFriend={addFriend}
                        onAccept={acceptRequest}
                        onRefresh={refreshFriendData}
                        router={router}
                      />
                    ))}
                  </ScrollView>
                </View>
              )}

              {browseLoading ? (
                <View style={styles.center}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                </View>
              ) : browseError ? (
                <Text style={styles.emptyText}>{browseError}</Text>
              ) : browseMembersFiltered.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Browse members</Text>
                  {browseMembersFiltered.map((m) => {
                    const status = getFriendStatus(m.id, friendData);
                    const incomingId = getIncomingRequestId(m.id, friendData);
                    return (
                      <Pressable
                        key={m.id}
                        style={({ pressed }) => [styles.browseRow, pressed && styles.buttonPressed]}
                        onPress={() => (router.push as (href: string) => void)(`/members/${m.id}`)}
                      >
                        <Avatar person={m} size={44} />
                        <View style={styles.friendInfo}>
                          <Text style={styles.friendName}>{fullName(m)}</Text>
                          <CityChip city={m.city} />
                        </View>
                        {status === "friends" && <Text style={styles.statusLabel}>Friends</Text>}
                        {status === "pending_outgoing" && (
                          <Text style={styles.statusLabel}>Request sent</Text>
                        )}
                        {(status === "none" || status === "pending_incoming") && (
                          <Pressable
                            style={({ pressed }) => [styles.addFriendBtn, pressed && styles.buttonPressed]}
                            onPress={(e) => {
                              e.stopPropagation();
                              if (status === "pending_incoming" && incomingId) {
                                void acceptRequest(incomingId).then(refreshFriendData);
                              } else {
                                void addFriend(m.id).then(refreshFriendData);
                              }
                            }}
                          >
                            <Text style={styles.addFriendBtnText}>
                              {status === "pending_incoming" ? "Accept" : "Add"}
                            </Text>
                          </Pressable>
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: { paddingVertical: 24, alignItems: "center" },
  tabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  tabBtnActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  tabBtnText: { fontSize: 14, fontWeight: "600", color: "#444" },
  tabBtnTextActive: { color: "#fff" },
  tabBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeOnActive: { backgroundColor: "#fff" },
  tabBadgeText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  tabBadgeTextOnActive: { color: theme.colors.primary },
  searchSection: { marginBottom: 16 },
  section: { marginBottom: 24 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  incomingRequestCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 8,
    backgroundColor: theme.colors.creamAlt,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    gap: 10,
  },
  incomingRequestActions: { flexDirection: "row", gap: 6 },
  incomingAcceptBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  incomingAcceptBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  incomingDeclineBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    minWidth: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  incomingDeclineBtnText: { color: theme.colors.primary, fontSize: 12, fontWeight: "600" },
  incomingActionDisabled: { opacity: 0.65 },
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
  searchIconOnly: {
    padding: 12,
    justifyContent: "center",
    minWidth: 48,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.8 },
  friendCard: {
    marginBottom: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    padding: 12,
  },
  friendCardMain: { flexDirection: "row", alignItems: "flex-start" },
  friendInfo: { flex: 1, marginLeft: 12, gap: 4 },
  friendName: { fontSize: 16, fontWeight: "600", color: "#333" },
  friendActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  messageBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  messageBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  unfriendBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  unfriendBtnText: { color: theme.colors.primary, fontSize: 13, fontWeight: "600" },
  cityChip: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.cream,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  cityChipText: { fontSize: 11, fontWeight: "600", color: theme.colors.primary },
  statusLabel: { fontSize: 12, color: "#666" },
  addFriendBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  addFriendBtnDisabled: { opacity: 0.7 },
  addFriendBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  emptyText: { fontSize: 14, color: "#888", marginTop: 8 },
  emptyState: { alignItems: "center", paddingVertical: 32, gap: 10 },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginTop: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    paddingHorizontal: 16,
    lineHeight: 20,
    marginBottom: 8,
  },
  friendsControls: { marginBottom: 12, gap: 10 },
  friendSearchInput: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#f9f9f9",
  },
  sortRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sortBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "#f0f0f0",
  },
  sortBtnActive: { backgroundColor: theme.colors.primary },
  sortBtnText: { fontSize: 13, fontWeight: "500", color: "#666" },
  sortBtnTextActive: { color: "#fff" },
  inviteBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: theme.colors.primary,
    marginTop: 8,
  },
  inviteBannerTitle: { fontSize: 14, fontWeight: "600", color: theme.colors.heading },
  inviteBannerText: { fontSize: 12, color: "#666", marginTop: 2 },
  inviteOutlineBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  inviteOutlineBtnText: { color: theme.colors.primary, fontSize: 14, fontWeight: "600" },
  hScroll: { gap: 12, paddingRight: 8, paddingBottom: 8 },
  discoverCard: {
    width: 168,
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    alignItems: "center",
    gap: 6,
  },
  discoverName: { fontSize: 14, fontWeight: "600", color: "#333", textAlign: "center" },
  reasonText: { fontSize: 11, color: "#666", textAlign: "center", minHeight: 28 },
  discoverAction: { marginTop: 4 },
  browseRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  outgoingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    gap: 10,
  },
});
