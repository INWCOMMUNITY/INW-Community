import { useCallback, useState, type ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Image,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, API_BASE, getToken } from "@/lib/api";

type ActivityNav =
  | { kind: "friend_request"; requestId: string }
  | { kind: "post"; postId: string; commentId?: string }
  | { kind: "blog"; slug: string }
  | { kind: "event_invites" }
  | { kind: "event"; slug: string }
  | { kind: "my_orders" }
  | { kind: "seller_orders" }
  | { kind: "buyer_order"; orderId: string }
  | { kind: "seller_order"; orderId: string }
  | { kind: "group"; slug: string }
  | { kind: "resale_chat"; conversationId: string }
  | { kind: "direct_message"; conversationId: string }
  | { kind: "none" };

interface ActivityLikeGroupMember {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
}

interface ActivityItem {
  id: string;
  type: string;
  category: string;
  title: string;
  subtitle: string | null;
  occurredAt: string;
  actor: {
    id: string;
    firstName: string;
    lastName: string;
    profilePhotoUrl: string | null;
  } | null;
  nav: ActivityNav;
  likeGroup?: {
    members: ActivityLikeGroupMember[];
    othersCount: number;
    target: "post" | "comment";
  };
}

function actorInitials(actor: ActivityItem["actor"]): string {
  if (!actor) return "";
  const a = (actor.firstName?.[0] ?? "") + (actor.lastName?.[0] ?? "");
  return a.toUpperCase() || "?";
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function resolveAppHref(nav: ActivityNav, blogTitle?: string | null): string | null {
  switch (nav.kind) {
    case "friend_request":
      return "/community/friend-requests";
    case "post": {
      const q =
        nav.commentId != null && nav.commentId !== ""
          ? `?commentId=${encodeURIComponent(nav.commentId)}`
          : "";
      return `/post/${nav.postId}${q}`;
    }
    case "blog": {
      const site = API_BASE.replace(/\/+$/, "");
      const title = (blogTitle || "Blog").slice(0, 80);
      return `/web?url=${encodeURIComponent(`${site}/blog/${nav.slug}`)}&title=${encodeURIComponent(title)}`;
    }
    case "event_invites":
      return "/community/invites";
    case "event":
      return `/event/${nav.slug}`;
    case "my_orders":
      return "/community/my-orders";
    case "seller_orders":
      return "/seller-hub/orders";
    case "buyer_order":
      return `/community/my-orders/${nav.orderId}`;
    case "seller_order":
      return `/seller-hub/orders/${nav.orderId}`;
    case "group":
      return `/community/group/${nav.slug}`;
    case "resale_chat":
      return `/messages/resale/${nav.conversationId}`;
    case "direct_message":
      return `/messages/${nav.conversationId}`;
    case "none":
    default:
      return null;
  }
}

/** Likes vs comments use distinct glyphs; other types fall back to category. */
function activityRowIcon(item: ActivityItem): keyof typeof Ionicons.glyphMap {
  switch (item.type) {
    case "post_like":
    case "comment_like":
    case "post_likes_group":
    case "comment_likes_group":
      return "heart";
    case "post_comment":
    case "blog_comment":
      return "chatbubbles-outline";
    case "direct_message":
      return "mail-outline";
    case "friend_request":
      return "person-add-outline";
    default:
      break;
  }
  switch (item.category) {
    case "social":
      return "people-outline";
    case "content":
      return "reader-outline";
    case "events":
      return "calendar-outline";
    case "groups":
      return "people-circle-outline";
    case "commerce":
      return "bag-handle-outline";
    default:
      return "notifications-outline";
  }
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [friendActionBusy, setFriendActionBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    getToken()
      .then((t) => {
        if (!t) {
          setError("Sign in to see your activity.");
          setItems([]);
          return null;
        }
        return apiGet<{ items?: ActivityItem[] }>("/api/me/activity-feed?limit=80");
      })
      .then((data) => {
        if (data === null) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setError(null);
      })
      .catch(() => {
        setItems([]);
        setError("Could not load activity. Check your connection and try again.");
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/+$/, "");

  const openItem = (item: ActivityItem) => {
    const blogTitle =
      item.nav.kind === "blog"
        ? (item.title.startsWith("Comment on: ")
            ? item.title.slice("Comment on: ".length).trim()
            : "Blog") || "Blog"
        : null;
    const href = resolveAppHref(item.nav, blogTitle);
    if (href) (router.push as (h: string) => void)(href);
  };

  const openMemberProfile = useCallback((memberId: string) => {
    (router.push as (h: string) => void)(`/members/${memberId}`);
  }, [router]);

  const respondToFriendRequest = async (requestId: string, status: "accepted" | "declined") => {
    setFriendActionBusy(requestId);
    try {
      await apiPatch(`/api/friend-requests/${requestId}`, { status });
      setItems((prev) =>
        prev.filter((it) => !(it.nav.kind === "friend_request" && it.nav.requestId === requestId))
      );
    } catch (e) {
      const msg = (e as { error?: string })?.error ?? "Something went wrong.";
      Alert.alert("Friend request", msg);
    } finally {
      setFriendActionBusy(null);
    }
  };

  const resolvePhoto = (path: string | null | undefined) => {
    if (!path) return null;
    return path.startsWith("http")
      ? path
      : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
  };

  const renderRowChrome = (
    item: ActivityItem,
    body: ReactNode,
    opts?: { onRowPress?: () => void; showChevron?: boolean }
  ) => {
    const icon = activityRowIcon(item);
    const g = item.likeGroup;
    const photo = item.actor ? resolvePhoto(item.actor.profilePhotoUrl) : null;

    const avatarSlot =
      g && g.members.length > 0 ? (
        <View style={styles.avatarStack} accessibilityLabel="People who liked this">
          {/* Oldest → newest left→right so the last-painted (most recent) sits on top */}
          {[...g.members].reverse().map((m, i) => {
            const uri = resolvePhoto(m.profilePhotoUrl);
            const initials =
              `${m.firstName?.[0] ?? ""}${m.lastName?.[0] ?? ""}`.toUpperCase() || "?";
            return (
              <Pressable
                key={m.id}
                onPress={() => openMemberProfile(m.id)}
                style={[
                  styles.avatarStackItem,
                  { marginLeft: i === 0 ? 0 : -12, zIndex: i + 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={`${displayMemberName(m)} profile`}
              >
                {uri ? (
                  <Image source={{ uri }} style={styles.avatarStackImage} />
                ) : (
                  <View style={[styles.avatarStackImage, styles.avatarStackPlaceholder]}>
                    <Text style={styles.avatarStackInitials}>{initials}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      ) : photo ? (
        <Image source={{ uri: photo }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarText}>{actorInitials(item.actor)}</Text>
        </View>
      );

    const inner = (
      <>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={22} color={theme.colors.primary} />
        </View>
        {avatarSlot}
        <View style={styles.rowBody}>{body}</View>
        <View style={styles.rowRight}>
          <Text style={styles.time}>{formatWhen(item.occurredAt)}</Text>
          {opts?.showChevron ? <Ionicons name="chevron-forward" size={18} color="#bbb" /> : null}
        </View>
      </>
    );
    if (opts?.onRowPress) {
      return (
        <Pressable
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={opts.onRowPress}
        >
          {inner}
        </Pressable>
      );
    }
    return <View style={styles.row}>{inner}</View>;
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.heading} />
        </Pressable>
        <Text style={styles.headerTitle}>Activity</Text>
        <Pressable
          onPress={() => (router.push as (h: string) => void)("/messages")}
          style={styles.headerInboxBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Inbox"
        >
          <Ionicons name="mail-outline" size={24} color={theme.colors.heading} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <Text style={styles.empty}>No recent activity yet. When people interact with your posts, orders, or invites, it will show up here.</Text>
          }
          renderItem={({ item }) => {
            const blogTitleForRow =
              item.nav.kind === "blog"
                ? item.title.startsWith("Comment on: ")
                  ? item.title.slice("Comment on: ".length).trim()
                  : "Blog"
                : null;
            const href = resolveAppHref(item.nav, blogTitleForRow);

            if (item.nav.kind === "friend_request") {
              const busy = friendActionBusy === item.nav.requestId;
              return renderRowChrome(
                item,
                <>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  {item.subtitle ? (
                    <View style={styles.subtitleClamp}>
                      {renderSubtitleWithLeadingMember(
                        item.subtitle,
                        item.actor,
                        openMemberProfile
                      )}
                    </View>
                  ) : null}
                  <View style={styles.friendActionsRow}>
                    <Pressable
                      style={[styles.friendActionApprove, busy && styles.friendActionDisabled]}
                      disabled={busy}
                      onPress={() => respondToFriendRequest(item.nav.requestId, "accepted")}
                    >
                      <Text style={styles.friendActionApproveText}>
                        {busy ? "…" : "Approve"}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.friendActionDecline, busy && styles.friendActionDisabled]}
                      disabled={busy}
                      onPress={() => respondToFriendRequest(item.nav.requestId, "declined")}
                    >
                      <Text style={styles.friendActionDeclineText}>
                        {busy ? "…" : "Decline"}
                      </Text>
                    </Pressable>
                  </View>
                </>
              );
            }

            return renderRowChrome(
              item,
              <>
                {item.likeGroup ? (
                  renderAggregatedLikeTitleView(item, openMemberProfile)
                ) : (
                  renderTitleWithLeadingMember(item.title, item.actor, openMemberProfile)
                )}
                {item.subtitle ? (
                  <View style={styles.subtitleClamp}>
                    {renderSubtitleWithLeadingMember(
                      item.subtitle,
                      item.actor,
                      openMemberProfile
                    )}
                  </View>
                ) : null}
              </>,
              href ? { onRowPress: () => openItem(item), showChevron: true } : undefined
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backBtn: { padding: 8, width: 40 },
  headerInboxBtn: { padding: 8, width: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  errorText: { fontSize: 15, color: "#666", textAlign: "center", marginBottom: 16 },
  retryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryBtnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  empty: { fontSize: 15, color: "#666", textAlign: "center", padding: 24, lineHeight: 22 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
  },
  rowPressed: { backgroundColor: "#f9f9f9" },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#f0f7f2",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#e5e5e5" },
  avatarStack: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 44,
    height: 44,
    paddingRight: 4,
  },
  avatarStackItem: {
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "#e5e5e5",
  },
  avatarStackImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#e5e5e5",
  },
  avatarStackPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  avatarStackInitials: {
    fontSize: 12,
    fontWeight: "700",
    color: "#666",
  },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontWeight: "600", color: "#666" },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.heading },
  linkedTextRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 0,
  },
  memberNameLink: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  subtitleClamp: { marginTop: 4 },
  rowSubtitle: { fontSize: 14, color: "#666", marginTop: 0, lineHeight: 19 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  time: { fontSize: 12, color: "#999" },
  friendActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  friendActionApprove: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  friendActionApproveText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  friendActionDecline: {
    borderWidth: 1,
    borderColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  friendActionDeclineText: { color: theme.colors.primary, fontWeight: "700", fontSize: 14 },
  friendActionDisabled: { opacity: 0.5 },
});

function displayMemberName(m: { firstName: string; lastName: string }): string {
  return [m.firstName, m.lastName].filter(Boolean).join(" ").trim() || "Someone";
}

function renderAggregatedLikeTitleView(
  item: ActivityItem,
  onMemberPress: (id: string) => void
): ReactNode {
  const g = item.likeGroup!;
  const suffix =
    g.target === "post" ? " liked your post" : " liked your comment";
  const { members, othersCount } = g;

  const nameLink = (m: ActivityLikeGroupMember) => (
    <Pressable key={m.id} onPress={() => onMemberPress(m.id)}>
      <Text style={styles.memberNameLink}>{displayMemberName(m)}</Text>
    </Pressable>
  );

  if (othersCount > 0) {
    const bits: ReactNode[] = [];
    members.forEach((m, i) => {
      if (i > 0) bits.push(<Text key={`,${i}`} style={styles.rowTitle}>, </Text>);
      bits.push(nameLink(m));
    });
    bits.push(
      <Text key="tail" style={styles.rowTitle}>
        {`, and ${othersCount} ${othersCount === 1 ? "other" : "others"}${suffix}`}
      </Text>
    );
    return <View style={styles.linkedTextRow}>{bits}</View>;
  }

  if (members.length === 2) {
    return (
      <View style={styles.linkedTextRow}>
        {nameLink(members[0])}
        <Text style={styles.rowTitle}> and </Text>
        {nameLink(members[1])}
        <Text style={styles.rowTitle}>{suffix}</Text>
      </View>
    );
  }

  return (
    <View style={styles.linkedTextRow}>
      {nameLink(members[0])}
      <Text style={styles.rowTitle}>, </Text>
      {nameLink(members[1])}
      <Text style={styles.rowTitle}>, and </Text>
      {nameLink(members[2])}
      <Text style={styles.rowTitle}>{suffix}</Text>
    </View>
  );
}

function renderTitleWithLeadingMember(
  title: string,
  member: ActivityItem["actor"],
  onMemberPress: (id: string) => void
): ReactNode {
  if (!member) return <Text style={styles.rowTitle}>{title}</Text>;
  const name = displayMemberName(member);
  const patterns = [
    `${name} liked your post`,
    `${name} liked your comment`,
    `${name} sent you a message`,
  ];
  for (const p of patterns) {
    if (title === p) {
      const rest = title.slice(name.length);
      return (
        <View style={styles.linkedTextRow}>
          <Pressable onPress={() => onMemberPress(member.id)}>
            <Text style={styles.memberNameLink}>{name}</Text>
          </Pressable>
          <Text style={styles.rowTitle}>{rest}</Text>
        </View>
      );
    }
  }
  return <Text style={styles.rowTitle}>{title}</Text>;
}

function renderSubtitleWithLeadingMember(
  subtitle: string,
  member: ActivityItem["actor"],
  onMemberPress: (id: string) => void
): ReactNode {
  if (!member) return <Text style={styles.rowSubtitle}>{subtitle}</Text>;
  const name = displayMemberName(member);
  const colon = `${name}: `;
  if (subtitle.startsWith(colon)) {
    const rest = subtitle.slice(colon.length);
    return (
      <View style={styles.linkedTextRow}>
        <Pressable onPress={() => onMemberPress(member.id)}>
          <Text style={styles.memberNameLink}>{name}</Text>
        </Pressable>
        <Text style={styles.rowSubtitle} numberOfLines={2}>
          : {rest}
        </Text>
      </View>
    );
  }
  const wants = `${name} wants to connect`;
  if (subtitle === wants) {
    return (
      <View style={styles.linkedTextRow}>
        <Pressable onPress={() => onMemberPress(member.id)}>
          <Text style={styles.memberNameLink}>{name}</Text>
        </Pressable>
        <Text style={styles.rowSubtitle}> wants to connect</Text>
      </View>
    );
  }
  const inv = `${name} invited you to `;
  if (subtitle.startsWith(inv)) {
    const rest = subtitle.slice(inv.length);
    return (
      <View style={styles.linkedTextRow}>
        <Pressable onPress={() => onMemberPress(member.id)}>
          <Text style={styles.memberNameLink}>{name}</Text>
        </Pressable>
        <Text style={styles.rowSubtitle}> invited you to {rest}</Text>
      </View>
    );
  }
  const admin = `${name} invited you to help admin `;
  if (subtitle.startsWith(admin)) {
    const rest = subtitle.slice(admin.length);
    return (
      <View style={styles.linkedTextRow}>
        <Pressable onPress={() => onMemberPress(member.id)}>
          <Text style={styles.memberNameLink}>{name}</Text>
        </Pressable>
        <Text style={styles.rowSubtitle}> invited you to help admin {rest}</Text>
      </View>
    );
  }
  const sale = `${name} · `;
  if (subtitle.startsWith(sale)) {
    const rest = subtitle.slice(sale.length);
    return (
      <View style={styles.linkedTextRow}>
        <Pressable onPress={() => onMemberPress(member.id)}>
          <Text style={styles.memberNameLink}>{name}</Text>
        </Pressable>
        <Text style={styles.rowSubtitle} numberOfLines={2}>
          {" "}
          · {rest}
        </Text>
      </View>
    );
  }
  return (
    <Text style={styles.rowSubtitle} numberOfLines={2}>
      {subtitle}
    </Text>
  );
}
