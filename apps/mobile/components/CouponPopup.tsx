import { useEffect, useState } from "react";
import {
  Modal,
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { useAuth } from "@/contexts/AuthContext";

const TAN_BG = "#f8e7c9";
const DARK_GREEN = "#3A624E";
const { height: SCREEN_HEIGHT } = Dimensions.get("window");

interface CouponPopupProps {
  couponId: string;
  onClose: () => void;
  initialSaved?: boolean;
  onSavedChange?: (saved: boolean) => void;
}

interface CouponData {
  id: string;
  name: string;
  discount: string;
  code: string | null;
  imageUrl: string | null;
  business: {
    name: string;
    address: string | null;
    city: string | null;
    phone: string | null;
  } | null;
  hasAccess: boolean;
}

function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const base = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
  const siteBase = base.replace(/\/api.*$/, "").replace(/\/$/, "");
  return url.startsWith("http") ? url : `${siteBase}${url.startsWith("/") ? "" : "/"}${url}`;
}

export function CouponPopup({
  couponId,
  onClose,
  initialSaved = false,
  onSavedChange,
}: CouponPopupProps) {
  const router = useRouter();
  const [data, setData] = useState<CouponData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(initialSaved);
  const [saving, setSaving] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const { member } = useAuth();

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved]);

  useEffect(() => {
    if (!couponId) return;
    setLoading(true);
    setError(null);
    apiGet<CouponData>(`/api/coupons/${couponId}`)
      .then(setData)
      .catch(() => setError("Could not load coupon"))
      .finally(() => setLoading(false));
  }, [couponId]);

  const handleSaveToggle = async () => {
    const token = await getToken();
    if (!token) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (saved) {
        await apiDelete(`/api/saved?type=coupon&referenceId=${encodeURIComponent(couponId)}`);
        setSaved(false);
        onSavedChange?.(false);
      } else {
        await apiPost("/api/saved", { type: "coupon", referenceId: couponId });
        setSaved(true);
        onSavedChange?.(true);
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Modal visible transparent animationType="fade" presentationStyle="overFullScreen">
        <View style={styles.backdrop}>
          <View style={[styles.panel, styles.loadingPanel]}>
            <ActivityIndicator size="large" color={DARK_GREEN} />
            <Text style={styles.loadingText}>Loading coupon…</Text>
          </View>
        </View>
      </Modal>
    );
  }

  if (error || !data) {
    return (
      <Modal visible transparent animationType="fade" presentationStyle="overFullScreen">
        <Pressable style={styles.backdrop} onPress={onClose}>
          <View style={[styles.panel, styles.errorPanel]}>
            <Text style={styles.errorText}>{error ?? "Coupon not found."}</Text>
            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    );
  }

  if (!data.hasAccess) {
    return (
      <Modal visible transparent animationType="fade" presentationStyle="overFullScreen">
        <Pressable style={styles.backdrop} onPress={onClose}>
          <View style={[styles.panel, styles.gatePanel]}>
            <Text style={styles.gateTitle}>Sorry, Coupons are only available to Northwest Community Subscribers</Text>
            <Text style={styles.gateText}>Subscribe to view and save coupons from local businesses.</Text>
            <Pressable
              style={styles.subscribeBtn}
              onPress={() => {
                onClose();
                (router.push as (href: string) => void)("/subscribe");
              }}
            >
              <Text style={styles.subscribeBtnText}>Sign up</Text>
            </Pressable>
            <Pressable onPress={onClose}>
              <Text style={styles.gateClose}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    );
  }

  const address = data.business?.address ?? (data.business?.city ? data.business.city : null);
  const imageUrl = resolveImageUrl(data.imageUrl);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.panel} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {data.name}
            </Text>
            <View style={styles.headerActions}>
              {member && (
                <Pressable
                  onPress={() => setShareModalOpen(true)}
                  style={({ pressed }) => [styles.shareBtn, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons name="share-outline" size={22} color={DARK_GREEN} />
                </Pressable>
              )}
              <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}>
                <Ionicons name="close" size={24} color={DARK_GREEN} />
              </Pressable>
            </View>
          </View>
          <ShareToChatModal
            visible={shareModalOpen}
            onClose={() => setShareModalOpen(false)}
            sharedContent={{ type: "coupon", id: data.id }}
          />

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {data.business?.name ? (
              <Text style={styles.businessName}>{data.business.name}</Text>
            ) : null}
            <Text style={styles.couponName}>{data.name}</Text>
            <Text style={styles.discount}>{data.discount}</Text>

            <View style={styles.imageBox}>
              {imageUrl ? (
                <Image source={{ uri: imageUrl }} style={styles.couponImage} resizeMode="contain" />
              ) : (
                <Text style={styles.noImage}>No image</Text>
              )}
            </View>

            {address ? (
              <View style={styles.addressSection}>
                <Text style={styles.addressLabel}>Redeemed at</Text>
                <Text style={styles.addressText}>{address}</Text>
              </View>
            ) : null}

            {data.code ? (
              <View style={styles.codeBox}>
                <Text style={styles.codeLabel}>Code</Text>
                <Text style={styles.codeValue}>{data.code}</Text>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.saveBtn, saving && styles.saveBtnDisabled, pressed && { opacity: 0.8 }]}
              onPress={handleSaveToggle}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name={saved ? "heart" : "heart-outline"} size={20} color="#fff" />
                  <Text style={styles.saveBtnText}>{saved ? "Saved" : "Save coupon"}</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </Pressable>
      </Pressable>
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
  panel: {
    backgroundColor: TAN_BG,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: DARK_GREEN,
    maxHeight: "90%",
    width: "100%",
    alignSelf: "center",
  },
  loadingPanel: {
    padding: 32,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: theme.colors.text,
  },
  errorPanel: {
    padding: 24,
    alignItems: "center",
  },
  errorText: {
    fontSize: 16,
    color: theme.colors.text,
    marginBottom: 16,
  },
  gatePanel: {
    padding: 24,
    alignItems: "center",
  },
  gateTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: DARK_GREEN,
    textAlign: "center",
    marginBottom: 12,
  },
  gateText: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 20,
  },
  subscribeBtn: {
    backgroundColor: DARK_GREEN,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  subscribeBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  gateClose: {
    marginTop: 16,
    fontSize: 16,
    color: DARK_GREEN,
    textDecorationLine: "underline",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: DARK_GREEN,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: DARK_GREEN,
    flex: 1,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  shareBtn: {
    padding: 4,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    maxHeight: SCREEN_HEIGHT * 0.75,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
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
    marginBottom: 16,
  },
  imageBox: {
    minHeight: 180,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 3,
    borderColor: DARK_GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
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
  addressSection: {
    marginBottom: 16,
  },
  addressLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: DARK_GREEN,
    textAlign: "center",
    marginBottom: 4,
  },
  addressText: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
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
  closeButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: DARK_GREEN,
    borderRadius: 8,
    backgroundColor: "#fff",
  },
  closeButtonText: {
    fontSize: 16,
    color: DARK_GREEN,
    fontWeight: "600",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: DARK_GREEN,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignSelf: "center",
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
