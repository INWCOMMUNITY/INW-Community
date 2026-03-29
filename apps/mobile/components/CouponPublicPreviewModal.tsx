import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  StyleSheet,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

const TAN_BG = "#f8e7c9";
const DARK_GREEN = theme.colors.primary;
const { height: SCREEN_HEIGHT } = Dimensions.get("window");

function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const base = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
  const siteBase = base.replace(/\/api.*$/, "").replace(/\/$/, "");
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

export type CouponPublicPreviewPayload = {
  businessName: string;
  name: string;
  discount: string;
  code: string;
  imageUrl: string | null;
  /** Shown like "Offer ends …" when set */
  expiresSummary?: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  preview: CouponPublicPreviewPayload | null;
};

/**
 * Approximates the subscriber-facing coupon sheet (see CouponPopup) for owners editing in Business Hub.
 */
export function CouponPublicPreviewModal({ visible, onClose, preview }: Props) {
  if (!preview) return null;

  const img = resolveImageUrl(preview.imageUrl);
  const code = preview.code.trim() || "—";
  const name = preview.name.trim() || "Coupon title";
  const discount = preview.discount.trim() || "Discount details";
  const biz = preview.businessName.trim() || "Business";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose}>
          <View style={{ flex: 1 }} />
        </Pressable>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewBadge}>Preview</Text>
              <Text style={styles.title} numberOfLines={2}>
                How subscribers see this coupon
              </Text>
            </View>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="close" size={24} color={DARK_GREEN} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.businessName}>{biz}</Text>
            <Text style={styles.couponName}>{name}</Text>
            <Text style={styles.discount}>{discount}</Text>

            {preview.expiresSummary ? (
              <Text style={styles.expiresLine}>{preview.expiresSummary}</Text>
            ) : null}

            <View style={styles.imageBox}>
              {img ? (
                <Image source={{ uri: img }} style={styles.couponImage} resizeMode="contain" />
              ) : (
                <Text style={styles.noImage}>No image</Text>
              )}
            </View>

            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Code</Text>
              <Text style={styles.codeValue}>{code}</Text>
            </View>

            <Text style={styles.footerNote}>
              Subscribers with a plan see the code and can save the coupon. Address shows here when listed on your
              business profile.
            </Text>

            <Pressable style={styles.doneBtn} onPress={onClose}>
              <Text style={styles.doneBtnText}>Done</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  backdropTouch: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  panel: {
    backgroundColor: TAN_BG,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: DARK_GREEN,
    maxHeight: "90%",
    width: "100%",
    alignSelf: "center",
    zIndex: 1,
    elevation: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: DARK_GREEN,
    gap: 8,
  },
  previewBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#92400e",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: DARK_GREEN,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    maxHeight: SCREEN_HEIGHT * 0.72,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 28,
  },
  businessName: {
    fontSize: 16,
    color: DARK_GREEN,
    textAlign: "center",
    marginBottom: 4,
  },
  couponName: {
    fontSize: 20,
    fontWeight: "700",
    color: DARK_GREEN,
    textAlign: "center",
    marginBottom: 4,
  },
  discount: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 8,
  },
  expiresLine: {
    fontSize: 14,
    color: "#92400e",
    textAlign: "center",
    marginBottom: 12,
    fontWeight: "500",
  },
  imageBox: {
    minHeight: 160,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 3,
    borderColor: DARK_GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    overflow: "hidden",
  },
  couponImage: {
    width: "100%",
    height: 200,
  },
  noImage: {
    fontSize: 16,
    color: "#999",
    padding: 16,
  },
  codeBox: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: DARK_GREEN,
    padding: 16,
    marginBottom: 16,
  },
  codeLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: DARK_GREEN,
    textAlign: "center",
    marginBottom: 4,
  },
  codeValue: {
    fontSize: 18,
    fontWeight: "700",
    color: DARK_GREEN,
    textAlign: "center",
  },
  footerNote: {
    fontSize: 13,
    color: "#666",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 16,
  },
  doneBtn: {
    backgroundColor: DARK_GREEN,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  doneBtnText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
});
