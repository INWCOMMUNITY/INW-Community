import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type Tab = "direct" | "resale" | "groups";

interface DirectConversation {
  id: string;
  memberA: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  memberB: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  messages: { content: string; createdAt: string; senderId: string }[];
  updatedAt: string;
}

interface ResaleConversation {
  id: string;
  storeItem: { id: string; title: string; slug: string; photos: string[] };
  buyer: { id: string; firstName: string; lastName: string };
  seller: { id: string; firstName: string; lastName: string };
  messages: { content: string; createdAt: string; senderId: string }[];
  updatedAt: string;
}

interface GroupConversation {
  id: string;
  name: string | null;
  createdBy: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  members: { member: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null } }[];
  messages: { content: string; createdAt: string; senderId: string }[];
  updatedAt: string;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "Just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d`;
  return d.toLocaleDateString();
}

export default function MessagesInboxScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { member } = useAuth();
  const myId = member?.id ?? "";
  const initialTab: Tab =
    params.tab === "resale"
      ? "resale"
      : params.tab === "groups"
        ? "groups"
        : "direct";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [direct, setDirect] = useState<DirectConversation[]>([]);
  const [resale, setResale] = useState<ResaleConversation[]>([]);
  const [groups, setGroups] = useState<GroupConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, r, g] = await Promise.all([
        apiGet<DirectConversation[]>("/api/direct-conversations"),
        apiGet<ResaleConversation[]>("/api/resale-conversations"),
        apiGet<GroupConversation[]>("/api/group-conversations"),
      ]);
      setDirect(Array.isArray(d) ? d : []);
      setResale(Array.isArray(r) ? r : []);
      setGroups(Array.isArray(g) ? g : []);
    } catch (err) {
      setDirect([]);
      setResale([]);
      setGroups([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const otherMember = (c: DirectConversation, myId: string) => {
    return c.memberA.id === myId ? c.memberB : c.memberA;
  };

  const list = tab === "direct" ? direct : tab === "groups" ? groups : resale;
  const isEmpty = list.length === 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Messages</Text>
        <View style={styles.headerActions}>
          {tab === "groups" && (
            <Pressable
              onPress={() => router.push("/messages/new-group")}
              style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="people-outline" size={22} color="#fff" />
            </Pressable>
          )}
          <Pressable
            onPress={() => router.push("/messages/new")}
            style={({ pressed }) => [styles.newBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="create-outline" size={24} color="#fff" />
          </Pressable>
        </View>
      </View>

      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === "direct" && styles.tabActive]}
          onPress={() => setTab("direct")}
        >
          <Text style={[styles.tabText, tab === "direct" && styles.tabTextActive]}>Direct</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "resale" && styles.tabActive]}
          onPress={() => setTab("resale")}
        >
          <Text style={[styles.tabText, tab === "resale" && styles.tabTextActive]}>Resale</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === "groups" && styles.tabActive]}
          onPress={() => setTab("groups")}
        >
          <Text style={[styles.tabText, tab === "groups" && styles.tabTextActive]}>Groups</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : isEmpty ? (
        <View style={styles.center}>
          <Ionicons name="chatbubbles-outline" size={64} color={theme.colors.placeholder} />
          <Text style={styles.emptyText}>
            {tab === "direct"
              ? "No direct messages yet"
              : tab === "groups"
                ? "No group chats yet"
                : "No resale conversations yet"}
          </Text>
          {tab === "direct" && (
            <Pressable
              onPress={() => router.push("/messages/new")}
              style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.emptyBtnText}>Start a conversation</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
          }
          renderItem={({ item }) => {
            if (tab === "groups") {
              const c = item as GroupConversation;
              const last = c.messages?.[0];
              const members = c.members ?? [];
              const name = c.name ?? (members.map((m) => m.member?.firstName).filter(Boolean).join(", ") || "Group");
              const firstPhoto = members[0]?.member?.profilePhotoUrl;
              const photoUrl = resolvePhotoUrl(firstPhoto ?? undefined);
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => router.push(`/messages/group/${c.id}`)}
                >
                  <View style={styles.avatarWrap}>
                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPlaceholder]}>
                        <Ionicons name="people" size={24} color={theme.colors.placeholder} />
                      </View>
                    )}
                  </View>
                  <View style={styles.rowContent}>
                    <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {last?.content ?? "No messages yet"}
                    </Text>
                  </View>
                  <Text style={styles.rowTime}>{last ? formatTime(last.createdAt) : ""}</Text>
                </Pressable>
              );
            }
            if (tab === "direct") {
              const c = item as DirectConversation;
              const last = c.messages?.[0];
              const other = otherMember(c, myId);
              const name = (other ? `${other.firstName ?? ""} ${other.lastName ?? ""}`.trim() : "") || "Unknown";
              const photoUrl = resolvePhotoUrl(other?.profilePhotoUrl ?? undefined);
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => router.push(`/messages/${c.id}`)}
                >
                  <View style={styles.avatarWrap}>
                    {photoUrl ? (
                      <Image source={{ uri: photoUrl }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPlaceholder]}>
                        <Ionicons name="person" size={24} color={theme.colors.placeholder} />
                      </View>
                    )}
                  </View>
                  <View style={styles.rowContent}>
                    <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {last?.content ?? "No messages yet"}
                    </Text>
                  </View>
                  <Text style={styles.rowTime}>{last ? formatTime(last.createdAt) : ""}</Text>
                </Pressable>
              );
            }
            const c = item as ResaleConversation;
            const last = c.messages?.[0];
            const title = c.storeItem?.title ?? "Item";
            const photo = c.storeItem?.photos?.[0];
            const photoUrl = resolvePhotoUrl(photo);
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => router.push(`/messages/resale/${c.id}`)}
              >
                <View style={styles.avatarWrap}>
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]}>
                      <Ionicons name="bag" size={24} color={theme.colors.placeholder} />
                    </View>
                  )}
                </View>
                <View style={styles.rowContent}>
                  <Text style={styles.rowName} numberOfLines={1}>{title}</Text>
                  <Text style={styles.rowPreview} numberOfLines={1}>
                    {last?.content ?? "No messages yet"}
                  </Text>
                </View>
                <Text style={styles.rowTime}>{last ? formatTime(last.createdAt) : ""}</Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8, marginLeft: -8 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    fontFamily: theme.fonts.heading,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  newBtn: { padding: 8 },
  tabs: {
    flexDirection: "row",
    backgroundColor: theme.colors.cream,
    padding: 4,
    margin: 16,
    marginBottom: 8,
    borderRadius: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 6,
  },
  tabActive: { backgroundColor: theme.colors.primary },
  tabText: { fontSize: 15, fontWeight: "600", color: theme.colors.text },
  tabTextActive: { color: "#fff" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyText: { fontSize: 16, color: theme.colors.placeholder, marginTop: 12, textAlign: "center" },
  emptyBtn: {
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  emptyBtnText: { fontSize: 16, fontWeight: "600", color: "#fff" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  rowPressed: { backgroundColor: "#f5f5f5" },
  avatarWrap: { marginRight: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: {
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 16, fontWeight: "600", color: theme.colors.heading },
  rowPreview: { fontSize: 14, color: theme.colors.placeholder, marginTop: 2 },
  rowTime: { fontSize: 12, color: theme.colors.placeholder, marginLeft: 8 },
});
