/**
 * Generic app navigation menu - shown when on tabs other than my-community.
 * Links to Profile, Seller Hub (if hasSeller), Business Hub (if sponsor or seller), Resale Hub (if hasSubscriber).
 */
import type { ComponentProps } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
  Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { useProfileView } from "@/contexts/ProfileViewContext";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
const NAV_HEADER_HEIGHT = 44;

const INSTAGRAM_URL = "https://www.instagram.com/northwest.community/?hl=en";
const FACEBOOK_URL = "https://www.facebook.com/people/Northwest-Community/61581601094411/";

const MENU_ICON_SIZE = 22;
const menuIconColor = theme.colors.primary;

interface AppNavMenuProps {
  visible: boolean;
  onClose: () => void;
  hasSeller: boolean;
  hasSubscriber?: boolean;
}

export function AppNavMenu({ visible, onClose, hasSeller, hasSubscriber }: AppNavMenuProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const drawerTop = insets.top + NAV_HEADER_HEIGHT;
  const { setProfileView, hasBusinessHub } = useProfileView();

  const handleNav = (view: "profile" | "business_hub" | "seller_hub" | "resale_hub") => {
    onClose();
    setProfileView(view);
    router.push("/(tabs)/my-community" as any);
  };

  const MenuRow = ({
    icon,
    label,
    onPress,
    labelTone,
  }: {
    icon: ComponentProps<typeof Ionicons>["name"];
    label: string;
    onPress: () => void;
    labelTone?: "default" | "primary";
  }) => (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
    >
      <View style={styles.navLinkRow}>
        <Ionicons name={icon} size={MENU_ICON_SIZE} color={menuIconColor} />
        <Text
          style={[
            styles.navLinkText,
            styles.navLinkWithIcon,
            labelTone === "primary" && { color: theme.colors.primary },
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.drawer, { top: drawerTop }]}>
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
              {hasBusinessHub && (
                <MenuRow
                  icon="business-outline"
                  label="Business Hub"
                  onPress={() => handleNav("business_hub")}
                />
              )}
              {hasSeller && (
                <MenuRow
                  icon="briefcase-outline"
                  label="Seller Hub"
                  onPress={() => handleNav("seller_hub")}
                />
              )}
              {hasSubscriber && (
                <MenuRow
                  icon="cash-outline"
                  label="Resale Hub"
                  onPress={() => handleNav("resale_hub")}
                />
              )}
              <MenuRow
                icon="chatbubbles-outline"
                label="Messages"
                onPress={() => {
                  onClose();
                  router.push("/messages" as import("expo-router").Href);
                }}
              />
              <MenuRow
                icon="person-outline"
                label="Profile"
                onPress={() => handleNav("profile")}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Northwest Community:</Text>
              <View style={styles.divider} />
              <MenuRow
                icon="share-social-outline"
                label="Share App"
                onPress={() => {
                  onClose();
                  router.push("/share-inw-community" as import("expo-router").Href);
                }}
              />
              <MenuRow
                icon="card-outline"
                label="Subscribe"
                labelTone="primary"
                onPress={() => {
                  onClose();
                  router.push("/subscribe" as import("expo-router").Href);
                }}
              />
              <MenuRow
                icon="logo-instagram"
                label="Instagram"
                onPress={() => {
                  onClose();
                  Linking.openURL(INSTAGRAM_URL).catch(() => {});
                }}
              />
              <MenuRow
                icon="logo-facebook"
                label="Facebook"
                onPress={() => {
                  onClose();
                  Linking.openURL(FACEBOOK_URL).catch(() => {});
                }}
              />
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
    position: "absolute",
    right: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
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
  navLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  navLinkWithIcon: {
    flex: 1,
  },
  navLinkText: {
    fontSize: 15,
    color: "#444",
  },
});
