import { useCallback, useEffect, useState } from "react";
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
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiDelete } from "@/lib/api";

type BlockedRow = {
  blockedId: string;
  blocked: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profilePhotoUrl: string | null;
  };
  createdAt: string;
};

export default function BlockedMembersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<BlockedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await apiGet<BlockedRow[]>("/api/members/block");
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleUnblock = (memberId: string, label: string) => {
    Alert.alert(
      "Unblock",
      `Unblock ${label}? They will be able to interact with you again according to your settings.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unblock",
          onPress: async () => {
            setUnblockingId(memberId);
            try {
              await apiDelete(`/api/members/block?memberId=${encodeURIComponent(memberId)}`);
              setItems((prev) => prev.filter((r) => r.blockedId !== memberId));
            } catch {
              Alert.alert("Error", "Could not unblock. Try again.");
            } finally {
              setUnblockingId(null);
            }
          },
        },
      ]
    );
  };

  const displayName = (b: BlockedRow["blocked"]) => {
    const n = [b.firstName, b.lastName].filter(Boolean).join(" ").trim();
    return n || "Member";
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={28} color={theme.colors.primary} />
        </Pressable>
        <Text style={styles.title}>Blocked people</Text>
        <View style={styles.headerRight} />
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={48} color="#ccc" />
          <Text style={styles.emptyText}>You haven’t blocked anyone.</Text>
          <Text style={styles.emptyHint}>
            When you block someone from a post or profile, they appear here. You can unblock anytime.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(r) => r.blockedId}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={theme.colors.primary} />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const name = displayName(item.blocked);
            const busy = unblockingId === item.blockedId;
            return (
              <View style={styles.row}>
                {item.blocked.profilePhotoUrl ? (
                  <Image source={{ uri: item.blocked.profilePhotoUrl }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Ionicons name="person" size={22} color="#999" />
                  </View>
                )}
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {name}
                  </Text>
                </View>
                <Pressable
                  onPress={() => handleUnblock(item.blockedId, name)}
                  disabled={busy}
                  style={({ pressed }) => [styles.unblockBtn, pressed && { opacity: 0.85 }]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.unblockLabel}>Unblock</Text>
                  )}
                </Pressable>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backBtn: {
    padding: 4,
    width: 44,
  },
  headerRight: {
    width: 44,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  emptyText: {
    marginTop: 16,
    fontSize: 17,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
  },
  emptyHint: {
    marginTop: 8,
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 20,
  },
  listContent: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e8e8e8",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f0f0f0",
  },
  avatarPlaceholder: {
    justifyContent: "center",
    alignItems: "center",
  },
  rowText: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: "#222",
  },
  unblockBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    minWidth: 88,
    alignItems: "center",
    justifyContent: "center",
  },
  unblockLabel: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});
