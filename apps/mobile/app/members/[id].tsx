import { useEffect, useState, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  Pressable,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, getToken } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";

interface Badge {
  id: string;
  name: string;
  slug: string;
}

interface FavoriteBusiness {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

interface MemberProfile {
  id: string;
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  bio: string | null;
  city: string | null;
  allTimePointsEarned: number;
  badges: Badge[];
  favoriteBusinesses: FavoriteBusiness[];
}

function resolveUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const base = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
  return path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

export default function MemberProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member: currentMember } = useAuth();

  const [profile, setProfile] = useState<MemberProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [friendStatus, setFriendStatus] = useState<"none" | "friends" | "pending_outgoing" | "pending_incoming">("none");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    if (!id || typeof id !== "string") return;
    setLoading(true);
    setError("");
    try {
      const data = await apiGet<MemberProfile>(`/api/members/${id}`);
      if (data) setProfile(data);
      else setError("Profile not found");
    } catch {
      setError("Could not load profile");
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!profile || !currentMember?.id || profile.id === currentMember.id) return;
    apiGet<{
      incoming: { requester: { id: string } }[];
      outgoing: { addressee: { id: string } }[];
      friends: { id: string }[];
    }>("/api/friend-requests")
      .then((data) => {
        if (data?.friends?.some((f: { id: string }) => f.id === profile.id)) setFriendStatus("friends");
        else if (data?.outgoing?.some((r: { addressee: { id: string } }) => r.addressee?.id === profile.id)) setFriendStatus("pending_outgoing");
        else if (data?.incoming?.some((r: { requester: { id: string } }) => r.requester?.id === profile.id)) setFriendStatus("pending_incoming");
        else setFriendStatus("none");
      })
      .catch(() => {});
  }, [profile?.id, currentMember?.id]);

  const handleAddFriend = async () => {
    if (!profile || actionLoading) return;
    setActionLoading("friend");
    try {
      await apiPost("/api/friend-requests", { addresseeId: profile.id });
      setFriendStatus("pending_outgoing");
    } catch {
      Alert.alert("Error", "Could not send friend request.");
    } finally {
      setActionLoading(null);
    }
  };

  const handleMessage = () => {
    if (!profile) return;
    router.push(`/messages/new?addresseeId=${profile.id}`);
  };

  const handleBlock = () => {
    if (!profile) return;
    Alert.alert(
      "Block member",
      `Block ${profile.firstName} ${profile.lastName}? You won't see their content and they won't be able to message you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            setActionLoading("block");
            try {
              await apiPost("/api/members/block", { memberId: profile.id });
              setMenuOpen(false);
              router.back();
            } catch {
              Alert.alert("Error", "Could not block.");
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleReport = () => {
    if (!profile) return;
    Alert.alert(
      "Report member",
      "Why are you reporting this member?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Political", onPress: () => submitReport("political") },
        { text: "Hate / harassment", onPress: () => submitReport("hate") },
        { text: "Spam", onPress: () => submitReport("spam") },
        { text: "Other", onPress: () => submitReport("other") },
      ]
    );
    setMenuOpen(false);
  };

  const submitReport = async (reason: "political" | "hate" | "nudity" | "spam" | "other") => {
    if (!profile) return;
    try {
      await apiPost("/api/reports", {
        contentType: "member",
        contentId: profile.id,
        reason,
      });
      Alert.alert("Report submitted", "Thank you. We will review this.");
    } catch {
      Alert.alert("Error", "Could not submit report.");
    }
  };

  const isOwnProfile = currentMember?.id === id;

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + 48 }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 16 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.primary} />
        </Pressable>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error || "Profile not found"}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Profile</Text>
        {!isOwnProfile && currentMember && (
          <Pressable style={styles.menuBtn} onPress={() => setMenuOpen(true)}>
            <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
          </Pressable>
        )}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileRow}>
          {profile.profilePhotoUrl ? (
            <Image source={{ uri: resolveUrl(profile.profilePhotoUrl) ?? profile.profilePhotoUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitials}>
                {profile.firstName?.[0]}
                {profile.lastName?.[0]}
              </Text>
            </View>
          )}
          <View style={styles.profileInfo}>
            <Text style={styles.name}>
              {profile.firstName} {profile.lastName}
            </Text>
            {profile.city && <Text style={styles.city}>{profile.city}</Text>}
            {profile.allTimePointsEarned > 0 && (
              <Text style={styles.points}>Reward points (all time): {profile.allTimePointsEarned}</Text>
            )}
          </View>
        </View>

        {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

        {profile.badges.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Badges</Text>
            <View style={styles.badgesRow}>
              {profile.badges.map((b) => (
                <View key={b.id} style={styles.badgeChip}>
                  <Text style={styles.badgeText}>{b.name}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {!isOwnProfile && currentMember && (
          <View style={styles.actionsRow}>
            {(friendStatus === "none" || friendStatus === "pending_incoming") && (
              <Pressable
                style={[styles.primaryBtn, { backgroundColor: theme.colors.primary }]}
                onPress={handleAddFriend}
                disabled={!!actionLoading}
              >
                <Text style={styles.primaryBtnText}>
                  {actionLoading === "friend" ? "…" : friendStatus === "pending_incoming" ? "Accept" : "Add friend"}
                </Text>
              </Pressable>
            )}
            {friendStatus === "friends" && <Text style={styles.friendsLabel}>Friends</Text>}
            {friendStatus === "pending_outgoing" && <Text style={styles.friendsLabel}>Request sent</Text>}
            <Pressable style={[styles.secondaryBtn, { borderColor: theme.colors.primary }]} onPress={handleMessage}>
              <Ionicons name="chatbubble-outline" size={20} color={theme.colors.primary} />
              <Text style={[styles.secondaryBtnText, { color: theme.colors.primary }]}>Message</Text>
            </Pressable>
          </View>
        )}

        {profile.favoriteBusinesses.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Favorite businesses</Text>
            {profile.favoriteBusinesses.map((b) => (
              <Pressable
                key={b.id}
                style={({ pressed }) => [styles.businessRow, pressed && styles.pressed]}
                onPress={() => router.push(`/business/${b.slug}`)}
              >
                {b.logoUrl ? (
                  <Image source={{ uri: resolveUrl(b.logoUrl) ?? b.logoUrl }} style={styles.businessLogo} />
                ) : (
                  <View style={[styles.businessLogo, styles.businessLogoPlaceholder]}>
                    <Text style={styles.businessLogoText}>{b.name[0]}</Text>
                  </View>
                )}
                <Text style={styles.businessName}>{b.name}</Text>
                <Ionicons name="chevron-forward" size={18} color={theme.colors.primary} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={menuOpen} transparent animationType="fade">
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuPanel}>
            <Pressable style={styles.menuItem} onPress={handleBlock}>
              <Text style={styles.menuItemDanger}>Block member</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={handleReport}>
              <Text style={styles.menuItemText}>Report member</Text>
            </Pressable>
            <Pressable style={styles.menuItem} onPress={() => setMenuOpen(false)}>
              <Text style={styles.menuItemText}>Cancel</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  backBtn: { padding: 8, marginRight: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700", color: "#fff" },
  menuBtn: { padding: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  profileRow: { flexDirection: "row", gap: 16, marginBottom: 16 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: { fontSize: 24, fontWeight: "700", color: "#666" },
  profileInfo: { flex: 1, justifyContent: "center" },
  name: { fontSize: 22, fontWeight: "700", color: theme.colors.heading },
  city: { fontSize: 14, color: "#666", marginTop: 4 },
  points: { fontSize: 13, color: "#666", marginTop: 4 },
  bio: { fontSize: 15, color: "#333", lineHeight: 22, marginBottom: 16 },
  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  badgeChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: "#f0f0f0" },
  badgeText: { fontSize: 12, color: "#555" },
  actionsRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  primaryBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  primaryBtnText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: "600" },
  friendsLabel: { fontSize: 15, color: "#666", alignSelf: "center" },
  businessRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 8,
    marginBottom: 8,
  },
  businessLogo: { width: 40, height: 40, borderRadius: 8 },
  businessLogoPlaceholder: { backgroundColor: "#eee", justifyContent: "center", alignItems: "center" },
  businessLogoText: { fontSize: 18, fontWeight: "700", color: "#666" },
  businessName: { flex: 1, fontSize: 15, color: "#333" },
  pressed: { opacity: 0.8 },
  errorText: { fontSize: 16, color: "#666" },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  menuPanel: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 },
  menuItem: { paddingVertical: 14 },
  menuItemText: { fontSize: 16, color: "#333" },
  menuItemDanger: { fontSize: 16, color: "#c00" },
});
