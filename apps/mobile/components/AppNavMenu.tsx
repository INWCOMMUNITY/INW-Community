/**
 * Generic app navigation menu - shown when on tabs other than my-community.
 * Links to Profile, Seller Hub (if hasSeller), Business Hub (if hasSponsor).
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
import { useProfileView } from "@/contexts/ProfileViewContext";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);

interface AppNavMenuProps {
  visible: boolean;
  onClose: () => void;
  hasSponsor: boolean;
  hasSeller: boolean;
  hasSubscriber?: boolean;
}

export function AppNavMenu({ visible, onClose, hasSponsor, hasSeller, hasSubscriber }: AppNavMenuProps) {
  const router = useRouter();
  const { setProfileView } = useProfileView();

  const handleNav = (view: "profile" | "business_hub" | "seller_hub" | "resale_hub") => {
    onClose();
    setProfileView(view);
    router.push("/(tabs)/my-community" as any);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.drawer}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Menu</Text>
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
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Go to</Text>
              <View style={styles.divider} />
              {hasSponsor && (
                <Pressable
                  onPress={() => handleNav("business_hub")}
                  style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
                >
                  <Text style={styles.navLinkText}>Business Hub</Text>
                </Pressable>
              )}
              {hasSeller && (
                <Pressable
                  onPress={() => handleNav("seller_hub")}
                  style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
                >
                  <Text style={styles.navLinkText}>Seller Hub</Text>
                </Pressable>
              )}
              {(hasSubscriber || hasSponsor) && (
                <Pressable
                  onPress={() => handleNav("resale_hub")}
                  style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
                >
                  <Text style={styles.navLinkText}>Resale Hub</Text>
                </Pressable>
              )}
              <Pressable
                onPress={() => handleNav("profile")}
                style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
              >
                <Text style={styles.navLinkText}>Profile</Text>
              </Pressable>
              <Pressable
                onPress={() => { onClose(); router.push("/subscribe" as import("expo-router").Href); }}
                style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
              >
                <Ionicons name="star" size={16} color={theme.colors.primary} style={{ marginRight: 4 }} />
                <Text style={[styles.navLinkText, { color: theme.colors.primary, fontWeight: "600" }]}>Subscribe</Text>
              </Pressable>
            </View>
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
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.heading,
    letterSpacing: 1,
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: "#e0e0e0",
    marginBottom: 12,
  },
  navLink: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  navLinkPressed: {
    opacity: 0.8,
    backgroundColor: "#f5f5f5",
  },
  navLinkText: {
    fontSize: 15,
    color: "#444",
  },
});
