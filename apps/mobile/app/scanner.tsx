import { useState, useRef, useCallback, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiPost, apiGet } from "@/lib/api";
import { PointsEarnedPopup } from "@/components/PointsEarnedPopup";

const SITE_DOMAINS = ["inwcommunity.com", "www.inwcommunity.com"];
const SCAN_PATH_REGEX = /\/scan\/([a-zA-Z0-9_-]+)/;

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

export default function ScannerScreen() {
  const router = useRouter();
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
  const cooldownRef = useRef(false);

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
        const me = await apiGet<{ points?: number }>("/api/me");
        const previousTotal = me?.points ?? 0;

        const result = await apiPost<{
          ok?: boolean;
          pointsAwarded?: number;
          totalPoints?: number;
          businessName?: string;
          error?: string;
        }>("/api/rewards/scan", { businessId });

        if (result.error) {
          setError(result.error);
          setTimeout(() => {
            setScanned(false);
            cooldownRef.current = false;
          }, 3000);
        } else {
          setPopupData({
            businessName: result.businessName ?? "Local Business",
            pointsAwarded: result.pointsAwarded ?? 0,
            previousTotal,
            newTotal: result.totalPoints ?? previousTotal,
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

  const handleClosePopup = () => {
    setPopupData(null);
    router.back();
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
        <View style={styles.topBar}>
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
        />
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
    paddingTop: 56,
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
});
