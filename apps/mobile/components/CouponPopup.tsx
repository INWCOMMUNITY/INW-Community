import { useEffect, useState, useRef } from "react";
import {
  Modal,
  StyleSheet,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  Dimensions,
  Keyboard,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete, getToken } from "@/lib/api";
import { ShareToChatModal } from "@/components/ShareToChatModal";
import { PointsEarnedPopup } from "@/components/PointsEarnedPopup";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";
import { useAuth } from "@/contexts/AuthContext";

const TAN_BG = "#f8e7c9";
const DARK_GREEN = theme.colors.primary;
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
  hasSecretKey: boolean;
  maxMonthlyUses: number;
  usedThisMonth: number;
  usedToday: boolean;
  business: {
    name: string;
    address: string | null;
    city: string | null;
    phone: string | null;
  } | null;
  hasAccess: boolean;
  isOwner: boolean;
}

function resolveImageUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const base = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
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

  const scrollRef = useRef<ScrollView>(null);
  const [secretKeyInput, setSecretKeyInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemSuccess, setRedeemSuccess] = useState<string | null>(null);
  const [pointsPopup, setPointsPopup] = useState<{
    businessName: string;
    pointsAwarded: number;
    previousTotal: number;
    newTotal: number;
  } | null>(null);
  const [earnedBadges, setEarnedBadges] = useState<
    { slug: string; name: string; description?: string }[]
  >([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvent, (e) => {
      setKeyboardOffset(e.endCoordinates.height / 2);
    });
    const onHide = Keyboard.addListener(hideEvent, () => {
      setKeyboardOffset(0);
    });
    return () => { onShow.remove(); onHide.remove(); };
  }, []);

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved]);

  useEffect(() => {
    if (!couponId) return;
    setLoading(true);
    setError(null);
    setSecretKeyInput("");
    setRedeemError(null);
    setRedeemSuccess(null);
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

  const handleRedeem = async () => {
    if (!secretKeyInput.trim()) {
      setRedeemError("Please enter the secret key.");
      return;
    }
    setRedeeming(true);
    setRedeemError(null);
    setRedeemSuccess(null);
    try {
      const me = await apiGet<{ points?: number }>("/api/me");
      const previousTotal = me?.points ?? 0;

      const res = await apiPost<{
        ok: boolean;
        pointsAwarded: number;
        usedThisMonth: number;
        maxMonthlyUses: number;
        earnedBadges?: { slug: string; name: string; description?: string }[];
      }>(
        `/api/coupons/${couponId}/redeem`,
        { secretKey: secretKeyInput.trim() }
      );
      if (res.earnedBadges?.length) {
        setEarnedBadges(res.earnedBadges);
      }
      setRedeemSuccess(`You earned ${res.pointsAwarded} Community Points! (${res.usedThisMonth}/${res.maxMonthlyUses} used this month)`);
      setSecretKeyInput("");
      if (data) {
        setData({ ...data, usedThisMonth: res.usedThisMonth, usedToday: true });
      }
      setPointsPopup({
        businessName: data?.business?.name ?? "Local Business",
        pointsAwarded: res.pointsAwarded,
        previousTotal,
        newTotal: previousTotal + res.pointsAwarded,
      });
    } catch (e) {
      const err = e as { error?: string };
      setRedeemError(err.error ?? "Failed to redeem. Try again.");
    } finally {
      setRedeeming(false);
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
    const signedIn = Boolean(member);
    return (
      <Modal visible transparent animationType="fade" presentationStyle="overFullScreen">
        <Pressable style={styles.backdrop} onPress={onClose}>
          <View style={[styles.panel, styles.gatePanel]}>
            <Text style={styles.gateTitle}>Sorry, coupons are only available to Northwest Community subscribers</Text>
            <Text style={styles.gateText}>
              {signedIn
                ? "Subscribe to view and save coupons from local businesses."
                : "Create an account and subscribe to view and save coupons from local businesses."}
            </Text>
            {!signedIn ? (
              <>
                <Pressable
                  style={styles.subscribeBtn}
                  onPress={() => {
                    onClose();
                    (router.push as (href: string) => void)("/signup-resident");
                  }}
                >
                  <Text style={styles.subscribeBtnText}>Sign up</Text>
                </Pressable>
                <Pressable
                  style={[styles.subscribeBtn, styles.gateBtnOutline]}
                  onPress={() => {
                    onClose();
                    (router.push as (href: string) => void)("/login");
                  }}
                >
                  <Text style={[styles.subscribeBtnText, styles.gateBtnOutlineText]}>Log in</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              style={[styles.subscribeBtn, !signedIn ? { marginTop: 12 } : undefined]}
              onPress={() => {
                onClose();
                (router.push as (href: string) => void)("/subscribe");
              }}
            >
              <Text style={styles.subscribeBtnText}>Subscribe to NWC</Text>
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

  const monthlyLimitReached = data.usedThisMonth >= data.maxMonthlyUses;
  const canRedeem = data.hasSecretKey && !data.isOwner && !data.usedToday && !monthlyLimitReached;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTouch} onPress={onClose}>
          <View style={{ flex: 1 }} />
        </Pressable>
        <View style={[styles.panel, keyboardOffset > 0 && { transform: [{ translateY: -keyboardOffset }] }]}>
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
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
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

            {data.hasSecretKey && !data.isOwner ? (
              <View style={styles.redeemSection}>
                <Text style={styles.redeemTitle}>Redeem Coupon</Text>
                <Text style={styles.redeemHint}>
                  Enter the secret key from the business to earn 10 Community Points.
                </Text>

                {data.usedThisMonth > 0 && (
                  <Text style={styles.usageText}>
                    Used {data.usedThisMonth}/{data.maxMonthlyUses} time{data.maxMonthlyUses === 1 ? "" : "s"} this month
                  </Text>
                )}

                {data.usedToday ? (
                  <View style={styles.statusBanner}>
                    <Ionicons name="checkmark-circle" size={20} color={DARK_GREEN} />
                    <Text style={styles.statusBannerText}>Already redeemed today. Come back tomorrow!</Text>
                  </View>
                ) : monthlyLimitReached ? (
                  <View style={styles.statusBanner}>
                    <Ionicons name="alert-circle" size={20} color="#c62828" />
                    <Text style={[styles.statusBannerText, { color: "#c62828" }]}>Monthly limit reached.</Text>
                  </View>
                ) : (
                  <View style={styles.redeemInputRow}>
                    <TextInput
                      style={styles.redeemInput}
                      placeholder="Enter secret key"
                      placeholderTextColor="#999"
                      value={secretKeyInput}
                      onChangeText={(t) => { setSecretKeyInput(t); setRedeemError(null); }}
                      autoCapitalize="none"
                      autoCorrect={true}
                      editable={!redeeming}
                      onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 300)}
                    />
                    <Pressable
                      style={({ pressed }) => [styles.redeemBtn, redeeming && { opacity: 0.6 }, pressed && { opacity: 0.8 }]}
                      onPress={handleRedeem}
                      disabled={redeeming}
                    >
                      {redeeming ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.redeemBtnText}>Submit</Text>
                      )}
                    </Pressable>
                  </View>
                )}

                {redeemError ? <Text style={styles.redeemError}>{redeemError}</Text> : null}
                {redeemSuccess ? (
                  <View style={styles.successBanner}>
                    <Ionicons name="star" size={18} color="#f9a825" />
                    <Text style={styles.successText}>{redeemSuccess}</Text>
                  </View>
                ) : null}
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
        </View>
      </View>

      {pointsPopup && (
        <PointsEarnedPopup
          visible={!!pointsPopup}
          onClose={() => {
            setPointsPopup(null);
            if (earnedBadges.length > 0) {
              setBadgePopupIndex(0);
            }
          }}
          businessName={pointsPopup.businessName}
          pointsAwarded={pointsPopup.pointsAwarded}
          previousTotal={pointsPopup.previousTotal}
          newTotal={pointsPopup.newTotal}
          category="coupon"
          message={`You're basically snipping them from the book! Thanks for using ${pointsPopup.businessName}'s coupon! Redeem more coupons for more savings and more points!`}
          buttonText="Super!"
          applyDoubleMultiplierAnimation={false}
        />
      )}

      {badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length && (
        <BadgeEarnedPopup
          visible
          onClose={() => {
            const next = badgePopupIndex + 1;
            if (next < earnedBadges.length) {
              setBadgePopupIndex(next);
            } else {
              setBadgePopupIndex(-1);
              setEarnedBadges([]);
            }
          }}
          badgeName={earnedBadges[badgePopupIndex].name}
          badgeSlug={earnedBadges[badgePopupIndex].slug}
          badgeDescription={earnedBadges[badgePopupIndex].description}
        />
      )}
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
    marginTop: 10,
  },
  gateBtnOutline: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: DARK_GREEN,
  },
  gateBtnOutlineText: {
    color: DARK_GREEN,
  },
  subscribeBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
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
  redeemSection: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 2,
    borderColor: DARK_GREEN,
    padding: 16,
    marginBottom: 16,
  },
  redeemTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: DARK_GREEN,
    textAlign: "center",
    marginBottom: 4,
  },
  redeemHint: {
    fontSize: 13,
    color: "#666",
    textAlign: "center",
    marginBottom: 10,
    lineHeight: 18,
  },
  usageText: {
    fontSize: 13,
    color: DARK_GREEN,
    textAlign: "center",
    marginBottom: 8,
    fontWeight: "600",
  },
  redeemInputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  redeemInput: {
    flex: 1,
    borderWidth: 2,
    borderColor: DARK_GREEN,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: theme.colors.text,
    backgroundColor: "#fafafa",
  },
  redeemBtn: {
    backgroundColor: DARK_GREEN,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
  },
  redeemBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  redeemError: {
    color: "#c62828",
    fontSize: 13,
    marginTop: 8,
    textAlign: "center",
  },
  successBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 10,
    backgroundColor: "#e8f5e9",
    borderRadius: 8,
    padding: 10,
  },
  successText: {
    color: DARK_GREEN,
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    padding: 10,
  },
  statusBannerText: {
    color: DARK_GREEN,
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
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
