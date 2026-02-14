/**
 * Community tab sidebar - Create Post, My Friends, Groups, Blogs, Invites, Badges.
 */
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);

interface CommunitySideMenuProps {
  visible: boolean;
  onClose: () => void;
  onOpenCreatePost?: () => void;
}

export function CommunitySideMenu({
  visible,
  onClose,
  onOpenCreatePost,
}: CommunitySideMenuProps) {
  const router = useRouter();

  const handleCreatePost = () => {
    onClose();
    onOpenCreatePost?.();
  };

  const handleNav = (href: string) => {
    onClose();
    (router.push as (href: string) => void)(href);
  };

  const items: { label: string; href: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { label: "Create Post", href: "create-post", icon: "create" },
    { label: "My Friends", href: "/community/my-friends", icon: "people" },
    { label: "Groups", href: "/community/groups", icon: "people-circle" },
    { label: "Blogs", href: "/community/blogs", icon: "newspaper" },
    { label: "Invites", href: "/community/invites", icon: "calendar" },
    { label: "Badges", href: "/my-badges", icon: "ribbon" },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.drawer}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Community</Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              hitSlop={12}
            >
              <Ionicons name="close" size={28} color={theme.colors.heading} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {items.map((item) => (
              <Pressable
                key={item.href}
                onPress={() =>
                  item.href === "create-post" ? handleCreatePost() : handleNav(item.href)
                }
                style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
              >
                <Ionicons name={item.icon} size={22} color={theme.colors.primary} />
                <Text style={styles.navLinkText}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={18} color="#999" />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  drawer: {
    width: DRAWER_WIDTH,
    maxHeight: "100%",
    backgroundColor: "#fff",
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  navLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  navLinkPressed: {
    opacity: 0.8,
    backgroundColor: "#f5f5f5",
  },
  navLinkText: {
    flex: 1,
    fontSize: 16,
    color: "#333",
    fontWeight: "500",
  },
});
