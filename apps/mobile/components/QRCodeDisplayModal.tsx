import { useState, useEffect, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  Image,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

interface QRCodeDisplayModalProps {
  visible: boolean;
  onClose: () => void;
  businessId: string | null;
  businessName: string;
}

export function QRCodeDisplayModal({
  visible,
  onClose,
  businessId,
  businessName,
}: QRCodeDisplayModalProps) {
  const insets = useSafeAreaInsets();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchQR = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError("");
    setImageUri(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("Please sign in to view your QR code.");
        return;
      }
      const res = await fetch(`${API_BASE}/api/businesses/${businessId}/qr`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `Request failed (${res.status})`
        );
      }
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const base64 = uint8ArrayToBase64(bytes);
      setImageUri(`data:image/png;base64,${base64}`);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load QR code.");
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (visible && businessId) {
      fetchQR();
    }
    if (!visible) {
      setImageUri(null);
      setError("");
    }
  }, [visible, businessId, fetchQR]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {businessName}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.body}>
          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.primary} />
          ) : error ? (
            <View style={styles.errorWrap}>
              <Ionicons name="alert-circle" size={48} color="#c00" />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
                onPress={fetchQR}
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </Pressable>
            </View>
          ) : imageUri ? (
            <View style={styles.qrWrap}>
              <View style={styles.qrCard}>
                <Image source={{ uri: imageUri }} style={styles.qrImage} resizeMode="contain" />
              </View>
              <Text style={styles.scanPrompt}>
                Have your customer scan this code{"\n"}to earn reward points
              </Text>
              <View style={styles.businessBadge}>
                <Ionicons name="storefront" size={18} color={theme.colors.primary} />
                <Text style={styles.businessBadgeText}>{businessName}</Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const QR_SIZE = Math.min(Dimensions.get("window").width - 64, 300);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
  },
  closeBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  qrWrap: {
    alignItems: "center",
  },
  qrCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  qrImage: {
    width: QR_SIZE,
    height: QR_SIZE,
  },
  scanPrompt: {
    marginTop: 24,
    fontSize: 16,
    color: theme.colors.heading,
    textAlign: "center",
    lineHeight: 24,
  },
  businessBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    backgroundColor: `${theme.colors.primary}12`,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: `${theme.colors.primary}30`,
  },
  businessBadgeText: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  errorWrap: {
    alignItems: "center",
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
  },
  retryBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  retryBtnText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
});
