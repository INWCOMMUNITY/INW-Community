import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, API_BASE, getToken } from "@/lib/api";

type ActivityNav =
  | { kind: "friend_requests" }
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
  | { kind: "none" };

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
    case "friend_requests":
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
    case "none":
    default:
      return null;
  }
}

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  social: "people-outline",
  content: "chatbubble-ellipses-outline",
  events: "calendar-outline",
  groups: "people-circle-outline",
  commerce: "bag-handle-outline",
};

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.heading} />
        </Pressable>
        <Text style={styles.headerTitle}>Activity</Text>
        <View style={{ width: 40 }} />
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
            const icon = CATEGORY_ICONS[item.category] ?? "notifications-outline";
            const photo = item.actor?.profilePhotoUrl
              ? item.actor.profilePhotoUrl.startsWith("http")
                ? item.actor.profilePhotoUrl
                : `${siteBase}${item.actor.profilePhotoUrl.startsWith("/") ? "" : "/"}${item.actor.profilePhotoUrl}`
              : null;
            const blogTitleForRow =
              item.nav.kind === "blog"
                ? item.title.startsWith("Comment on: ")
                  ? item.title.slice("Comment on: ".length).trim()
                  : "Blog"
                : null;
            const href = resolveAppHref(item.nav, blogTitleForRow);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => openItem(item)}
                disabled={!href}
              >
                <View style={styles.iconWrap}>
                  <Ionicons name={icon} size={22} color={theme.colors.primary} />
                </View>
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarText}>{actorInitials(item.actor)}</Text>
                  </View>
                )}
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{item.title}</Text>
                  {item.subtitle ? (
                    <Text style={styles.rowSubtitle} numberOfLines={2}>
                      {item.subtitle}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.rowRight}>
                  <Text style={styles.time}>{formatWhen(item.occurredAt)}</Text>
                  {href ? <Ionicons name="chevron-forward" size={18} color="#bbb" /> : null}
                </View>
              </Pressable>
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
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontWeight: "600", color: "#666" },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 15, fontWeight: "600", color: theme.colors.heading },
  rowSubtitle: { fontSize: 14, color: "#666", marginTop: 4, lineHeight: 19 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  time: { fontSize: 12, color: "#999" },
});
