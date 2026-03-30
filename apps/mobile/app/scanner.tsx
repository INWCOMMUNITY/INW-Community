import { useState, useRef, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Dimensions,
  Modal,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiPost, apiGet, API_BASE } from "@/lib/api";
import { PointsEarnedPopup } from "@/components/PointsEarnedPopup";
import { useAuth } from "@/contexts/AuthContext";
import { BadgeEarnedPopup } from "@/components/BadgeEarnedPopup";

const PENDING_SCAN_KEY = "nwc_pending_scan_business_id";

let CameraView: any = null;
let useCameraPermissions: any = null;
let cameraAvailable = false;
try {
  const cam = require("expo-camera");
  CameraView = cam.CameraView;
  useCameraPermissions = cam.useCameraPermissions;
  cameraAvailable = !!CameraView && !!useCameraPermissions;
} catch {
  cameraAvailable = false;
}

const SITE_DOMAINS = ["inwcommunity.com", "www.inwcommunity.com"];
const SCAN_PATH_REGEX = /\/scan\/([a-zA-Z0-9_-]+)/;

/** Points popup: use wallet delta so scan (incl. subscriber 2×) + badge bonuses match “+N” and total. */
function pointsEarnedDeltaForScanPopup(
  previousTotal: number,
  result: { pointsAwarded?: number; totalPoints?: number }
): number {
  const next = result.totalPoints;
  if (typeof next === "number" && Number.isFinite(next)) {
    const d = next - previousTotal;
    if (d > 0) return d;
  }
  return Math.max(0, result.pointsAwarded ?? 0);
}

function extractBusinessId(data: string): string | null {
  try {
    const url = new URL(data);
    if (SITE_DOMAINS.includes(url.hostname)) {
      const match = url.pathname.match(SCAN_PATH_REGEX);
      if (match) return match[1];
    }
  } catch {
    // Not a URL
  }
  if (/^[a-z0-9]{20,}$/i.test(data.trim())) return data.trim();
  return null;
}

function ScannerWithExpoCamera() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [popupData, setPopupData] = useState<{
    businessName: string;
    pointsAwarded: number;
    previousTotal: number;
    newTotal: number;
  } | null>(null);
  const [earnedBadges, setEarnedBadges] = useState<
    { slug: string; name: string; description?: string }[]
  >([]);
  const [badgePopupIndex, setBadgePopupIndex] = useState(-1);
  const cooldownRef = useRef(false);
  const [guestPopup, setGuestPopup] = useState<{
    pointsIfEarned: number;
    businessName: string;
    businessId: string;
  } | null>(null);

  const tryClaimPendingScan = useCallback(async () => {
    try {
      const pending = await AsyncStorage.getItem(PENDING_SCAN_KEY);
      if (!pending) return;
      const me = await apiGet<{ points?: number }>("/api/me");
      const previousTotal = me?.points ?? 0;
      const result = await apiPost<{
        ok?: boolean;
        pointsAwarded?: number;
        totalPoints?: number;
        businessName?: string;
        error?: string;
        earnedBadges?: { slug: string; name: string; description?: string }[];
      }>("/api/rewards/scan", { businessId: pending });
      await AsyncStorage.removeItem(PENDING_SCAN_KEY);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.earnedBadges?.length) {
        setEarnedBadges(result.earnedBadges);
      }
      const newTotal = result.totalPoints ?? previousTotal;
      setPopupData({
        businessName: result.businessName ?? "Local Business",
        pointsAwarded: pointsEarnedDeltaForScanPopup(previousTotal, result),
        previousTotal,
        newTotal,
      });
    } catch (e) {
      if (__DEV__) console.warn("[scanner] pending scan claim failed", e);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      tryClaimPendingScan();
    }, [tryClaimPendingScan])
  );

  const handleBarCodeScanned = useCallback(
    async ({ data }: { data: string }) => {
      if (scanned || cooldownRef.current || loading) return;
      const businessId = extractBusinessId(data);
      if (!businessId) return;

      cooldownRef.current = true;
      setScanned(true);
      setLoading(true);
      setError("");

      try {
        let me: { points?: number } | null = null;
        try {
          me = await apiGet<{ points?: number }>("/api/me");
        } catch {
          me = null;
        }

        if (!me) {
          const previewUrl = `${API_BASE.replace(/\/$/, "")}/api/rewards/scan-preview?businessId=${encodeURIComponent(businessId)}`;
          const res = await fetch(previewUrl, {
            method: "GET",
            headers: { Accept: "application/json" },
          });
          const preview = await res.json().catch(() => ({})) as {
            requiresAuth?: boolean;
            pointsIfEarned?: number;
            businessName?: string;
            error?: string;
          };
          if (preview.error) {
            setError(preview.error);
          } else {
            setGuestPopup({
              pointsIfEarned: preview.pointsIfEarned ?? 10,
              businessName: preview.businessName ?? "Local Business",
              businessId,
            });
          }
          setTimeout(() => {
            setScanned(false);
            cooldownRef.current = false;
          }, 500);
          setLoading(false);
          return;
        }

        const previousTotal = me?.points ?? 0;
        const result = await apiPost<{
          ok?: boolean;
          pointsAwarded?: number;
          totalPoints?: number;
          businessName?: string;
          error?: string;
          earnedBadges?: { slug: string; name: string; description?: string }[];
        }>("/api/rewards/scan", { businessId });

        if (result.error) {
          setError(result.error);
          setTimeout(() => {
            setScanned(false);
            cooldownRef.current = false;
          }, 3000);
        } else {
          if (result.earnedBadges?.length) {
            setEarnedBadges(result.earnedBadges);
          }
          const newTotal = result.totalPoints ?? previousTotal;
          setPopupData({
            businessName: result.businessName ?? "Local Business",
            pointsAwarded: pointsEarnedDeltaForScanPopup(previousTotal, result),
            previousTotal,
            newTotal,
          });
        }
      } catch (e) {
        const err = e as { error?: string; status?: number };
        setError(err?.error ?? "Scan failed. Please try again.");
        setTimeout(() => {
          setScanned(false);
          cooldownRef.current = false;
        }, 3000);
      } finally {
        setLoading(false);
      }
    },
    [scanned, loading]
  );

  const handleGuestSignIn = () => {
    if (guestPopup) {
      AsyncStorage.setItem(PENDING_SCAN_KEY, guestPopup.businessId);
      setGuestPopup(null);
      router.push("/(auth)/login" as never);
    }
  };

  const handleGuestSignUp = () => {
    if (guestPopup) {
      AsyncStorage.setItem(PENDING_SCAN_KEY, guestPopup.businessId);
      setGuestPopup(null);
      router.push("/(auth)/login" as never);
    }
  };

  const handleClosePopup = () => {
    setPopupData(null);
    if (earnedBadges.length > 0) {
      setBadgePopupIndex(0);
    } else {
      router.back();
    }
  };

  const handleCloseBadgePopup = () => {
    const next = badgePopupIndex + 1;
    if (next < earnedBadges.length) {
      setBadgePopupIndex(next);
    } else {
      setBadgePopupIndex(-1);
      setEarnedBadges([]);
      router.back();
    }
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={64} color={theme.colors.primary} style={{ marginBottom: 16 }} />
        <Text style={styles.permTitle}>Camera Access Required</Text>
        <Text style={styles.permDesc}>
          We need your camera to scan QR codes from local businesses and earn Community Points.
        </Text>
        <Pressable style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Camera Access</Text>
        </Pressable>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      <View style={styles.overlay}>
        <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
          <Pressable style={styles.closeButton} onPress={() => router.back()}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Text style={styles.title}>Scan QR Code</Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.scanArea}>
          <View style={styles.cornerTL} />
          <View style={styles.cornerTR} />
          <View style={styles.cornerBL} />
          <View style={styles.cornerBR} />
        </View>

        <View style={styles.bottomBar}>
          {loading ? (
            <ActivityIndicator size="large" color="#fff" />
          ) : error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : (
            <Text style={styles.hint}>
              Point your camera at a business QR code to earn points
            </Text>
          )}
        </View>
      </View>

      {popupData && (
        <PointsEarnedPopup
          visible={!!popupData}
          onClose={handleClosePopup}
          businessName={popupData.businessName}
          pointsAwarded={popupData.pointsAwarded}
          previousTotal={popupData.previousTotal}
          newTotal={popupData.newTotal}
          category="qr"
          applyDoubleMultiplierAnimation={member?.hasPaidSubscription === true}
        />
      )}

      {badgePopupIndex >= 0 && badgePopupIndex < earnedBadges.length && (
        <BadgeEarnedPopup
          visible
          onClose={handleCloseBadgePopup}
          badgeName={earnedBadges[badgePopupIndex].name}
          badgeSlug={earnedBadges[badgePopupIndex].slug}
          badgeDescription={earnedBadges[badgePopupIndex].description}
        />
      )}

      {guestPopup && (
        <Modal visible transparent animationType="fade">
          <View style={styles.guestModalBackdrop}>
            <View style={styles.guestModalBox}>
              <Text style={styles.guestModalTitle}>
                Earn {guestPopup.pointsIfEarned} points
              </Text>
              <Text style={styles.guestModalDesc}>
                Log in or sign up to earn {guestPopup.pointsIfEarned} points from {guestPopup.businessName}.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.guestModalBtn, pressed && { opacity: 0.8 }]}
                onPress={handleGuestSignIn}
              >
                <Text style={styles.guestModalBtnText}>Log in</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.guestModalBtnSecondary, pressed && { opacity: 0.8 }]}
                onPress={handleGuestSignUp}
              >
                <Text style={styles.guestModalBtnTextSecondary}>Sign up</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.guestModalCancel, pressed && { opacity: 0.8 }]}
                onPress={() => {
                  setGuestPopup(null);
                  setScanned(false);
                  cooldownRef.current = false;
                }}
              >
                <Text style={styles.guestModalCancelText}>Maybe later</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const { width } = Dimensions.get("window");
const SCAN_SIZE = width * 0.65;
const CORNER_SIZE = 30;
const CORNER_WIDTH = 4;

const cornerBase = {
  position: "absolute" as const,
  width: CORNER_SIZE,
  height: CORNER_SIZE,
  borderColor: theme.colors.primary,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#fff",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  scanArea: {
    width: SCAN_SIZE,
    height: SCAN_SIZE,
    alignSelf: "center",
  },
  cornerTL: {
    ...cornerBase,
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: 8,
  },
  cornerTR: {
    ...cornerBase,
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: 8,
  },
  cornerBL: {
    ...cornerBase,
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: 8,
  },
  cornerBR: {
    ...cornerBase,
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: 8,
  },
  bottomBar: {
    alignItems: "center",
    paddingBottom: 80,
    paddingHorizontal: 32,
  },
  hint: {
    fontSize: 15,
    color: "#fff",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  errorText: {
    fontSize: 15,
    color: "#ff6b6b",
    textAlign: "center",
    fontWeight: "600",
  },
  permTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 8,
    textAlign: "center",
  },
  permDesc: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  permBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    marginBottom: 12,
  },
  permBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  backBtn: {
    paddingVertical: 10,
  },
  backBtnText: {
    color: theme.colors.primary,
    fontSize: 15,
    fontWeight: "500",
  },
  guestModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  guestModalBox: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    width: "100%",
    maxWidth: 320,
  },
  guestModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 8,
  },
  guestModalDesc: {
    fontSize: 15,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 20,
  },
  guestModalBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 10,
  },
  guestModalBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  guestModalBtnSecondary: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 10,
  },
  guestModalBtnTextSecondary: { color: theme.colors.primary, fontSize: 16, fontWeight: "600" },
  guestModalCancel: {
    paddingVertical: 12,
    alignItems: "center",
  },
  guestModalCancelText: { color: theme.colors.placeholder, fontSize: 15 },
});

function ScannerNoExpoCamera() {
  const router = useRouter();
  return (
    <View style={styles.center}>
      <Ionicons name="camera-outline" size={64} color={theme.colors.primary} style={{ marginBottom: 16 }} />
      <Text style={styles.permTitle}>Camera Not Available</Text>
      <Text style={styles.permDesc}>
        The QR scanner requires a custom build and is not available in Expo Go. Please use a development or production
        build.
      </Text>
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Text style={styles.backBtnText}>Go Back</Text>
      </Pressable>
    </View>
  );
}

export default function ScannerScreen() {
  if (!cameraAvailable) {
    return <ScannerNoExpoCamera />;
  }
  return <ScannerWithExpoCamera />;
}
