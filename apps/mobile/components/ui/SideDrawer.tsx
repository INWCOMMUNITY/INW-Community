import type { ComponentProps, ReactNode } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { AppBadge } from "./AppBadge";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
export const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
/** Match the green tab/stack toolbar (Android 56, iOS 44). */
export const NAV_HEADER_HEIGHT = Platform.OS === "android" ? 56 : 44;

export function SideDrawer({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const drawerTop = insets.top + NAV_HEADER_HEIGHT;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.drawer, { top: drawerTop }]}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>{title}</Text>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close menu"
            >
              <Ionicons name="close" size={28} color={theme.colors.heading} />
            </Pressable>
          </View>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function SideDrawerSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.divider} />
      {children}
    </View>
  );
}

export function SideDrawerRow({
  icon,
  label,
  onPress,
  chevron = true,
  badgeCount,
  badgeExclamation,
  labelTone,
}: {
  icon?: ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
  chevron?: boolean;
  badgeCount?: number;
  badgeExclamation?: boolean;
  labelTone?: "default" | "primary";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.navLink, pressed && styles.navLinkPressed]}
    >
      <View style={styles.navLinkLeft}>
        {icon ? (
          <View style={styles.navLinkIcon}>
            <Ionicons name={icon} size={22} color={theme.colors.primary} />
          </View>
        ) : null}
        <Text
          style={[
            styles.navLinkText,
            labelTone === "primary" && { color: theme.colors.primary },
          ]}
        >
          {label}
        </Text>
      </View>
      <View style={styles.navLinkRight}>
        {(badgeExclamation || (badgeCount ?? 0) > 0) && (
          <AppBadge
            exclamation={badgeExclamation}
            label={badgeExclamation ? undefined : badgeCount}
          />
        )}
        {chevron ? (
          <Ionicons name="chevron-forward" size={18} color={theme.colors.labelMuted} />
        ) : null}
      </View>
    </Pressable>
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
    backgroundColor: theme.colors.surface,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderMuted,
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
    padding: theme.spacing.lg,
    paddingBottom: 32,
  },
  section: {
    marginBottom: theme.spacing.xxl,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.heading,
    letterSpacing: 1,
    marginBottom: theme.spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  navLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.md,
  },
  navLinkPressed: {
    opacity: 0.8,
    backgroundColor: theme.colors.surfacePressed,
  },
  navLinkLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },
  navLinkIcon: {
    marginRight: theme.spacing.md,
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  navLinkText: {
    fontSize: 15,
    color: theme.colors.menuRowText,
    flex: 1,
  },
  navLinkRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
});
