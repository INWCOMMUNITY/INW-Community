import {
  Modal,
  View,
  Text,
  Pressable,
  Image,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

export type OrderSuccessItem = {
  storeItemId: string;
  slug: string;
  title: string;
  photoUrl?: string;
  orderId?: string;
};

type Props = {
  visible: boolean;
  items?: OrderSuccessItem[];
  onViewItem: (item?: OrderSuccessItem) => void;
  onKeepShopping: () => void;
};

const MAX_VISIBLE_PHOTOS = 4;

function overlayColor(hex: string, alpha: number): string {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n) || full.length !== 6) {
    return `rgba(93, 79, 64, ${alpha})`;
  }
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Full-screen purchase success overlay shown after checkout.
 */
export function OrderSuccessOverlay({
  visible,
  items = [],
  onViewItem,
  onKeepShopping,
}: Props) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const panelWidth = Math.min(width * 0.88, 420);
  const panelMaxHeight = height * 0.8;
  const uniqueItems = items.filter((item, index, list) =>
    list.findIndex((row) => row.storeItemId === item.storeItemId) === index
  );
  const visibleItems = uniqueItems.slice(0, MAX_VISIBLE_PHOTOS);
  const extraCount = uniqueItems.length - visibleItems.length;
  const photoCount = uniqueItems.length;
  const photoSize =
    photoCount <= 1 ? Math.min(168, panelWidth - 56) : photoCount === 2 ? 118 : 92;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onKeepShopping}
    >
      <View style={[styles.backdrop, { backgroundColor: overlayColor(theme.colors.earth, 0.5) }]}>
        <View
          style={[
            styles.panel,
            {
              width: panelWidth,
              maxHeight: panelMaxHeight,
              backgroundColor: theme.colors.creamAlt,
              borderColor: theme.colors.earth,
            },
          ]}
        >
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={[
                styles.checkWrap,
                { backgroundColor: theme.colors.gold },
              ]}
            >
              <Ionicons name="checkmark" size={22} color={theme.colors.onPrimary} />
            </View>
            <Text
              style={[
                styles.title,
                {
                  fontFamily: theme.fonts.heading,
                  color: theme.colors.heading,
                },
              ]}
            >
              Thanks for Shopping Local!
            </Text>
            <Text
              style={[
                styles.subtitle,
                {
                  fontFamily: theme.fonts.body,
                  color: theme.colors.text,
                },
              ]}
            >
              Your order was a success!
            </Text>

            {photoCount === 0 ? (
              <View style={styles.logoWrap}>
                <Image
                  source={require("@/assets/images/nwc-community-logo.png")}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel="Northwest Community logo"
                />
              </View>
            ) : (
              <View style={styles.photos}>
                {visibleItems.map((item, index) => {
                  const isLastVisible = index === visibleItems.length - 1 && extraCount > 0;
                  return (
                    <Pressable
                      key={item.storeItemId}
                      onPress={() => onViewItem(item)}
                      accessibilityRole="button"
                      accessibilityLabel={item.title ? `View ${item.title}` : "View Item"}
                      style={({ pressed }) => [
                        { width: photoSize, height: photoSize, overflow: "hidden" },
                        pressed && styles.photoPressed,
                      ]}
                    >
                      {item.photoUrl ? (
                        <Image
                          source={{ uri: item.photoUrl }}
                          style={[
                            styles.photo,
                            {
                              width: photoSize,
                              height: photoSize,
                              borderColor: theme.colors.earth,
                            },
                          ]}
                          resizeMode="cover"
                        />
                      ) : (
                        <View
                          style={[
                            styles.photo,
                            styles.photoPlaceholder,
                            {
                              width: photoSize,
                              height: photoSize,
                              borderColor: theme.colors.earth,
                              backgroundColor: theme.colors.cream,
                            },
                          ]}
                        >
                          <Ionicons name="image-outline" size={28} color={theme.colors.earth} />
                        </View>
                      )}
                      {isLastVisible ? (
                        <View style={styles.extraBadge}>
                          <Text style={styles.extraBadgeText}>+{extraCount}</Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: theme.colors.primary },
                pressed && styles.btnPressed,
              ]}
              onPress={() => onViewItem(uniqueItems[0])}
              accessibilityRole="button"
              accessibilityLabel="View Item"
            >
              <Text style={[styles.btnText, { color: theme.colors.onPrimary }]}>View Item</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: theme.colors.earth },
                pressed && styles.btnPressed,
              ]}
              onPress={onKeepShopping}
              accessibilityRole="button"
              accessibilityLabel="Keep Shopping"
            >
              <Text style={[styles.btnText, { color: theme.colors.onPrimary }]}>Keep Shopping</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  panel: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    alignItems: "stretch",
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    alignItems: "center",
    paddingBottom: 8,
  },
  checkWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "500",
    textAlign: "center",
    marginBottom: 18,
  },
  logoWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    marginBottom: 8,
  },
  logo: {
    width: 96,
    height: 96,
  },
  photos: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    width: "100%",
    marginBottom: 8,
  },
  photo: {
    borderRadius: 12,
    borderWidth: 2,
    backgroundColor: "#fff",
    overflow: "hidden",
  },
  photoPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  photoPressed: {
    opacity: 0.85,
  },
  extraBadge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
    backgroundColor: "rgba(62, 67, 47, 0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  extraBadgeText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  actions: {
    width: "100%",
    gap: 12,
    marginTop: 16,
  },
  btn: {
    width: "100%",
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: "center",
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnText: {
    fontSize: 18,
    fontWeight: "700",
  },
});
