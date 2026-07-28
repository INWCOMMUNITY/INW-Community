import { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "expo-router";

interface PriceAlertModalProps {
  visible: boolean;
  onClose: () => void;
  storeItemId: string;
  storeItemTitle: string;
  currentPrice: number;
}

interface ExistingAlert {
  id: string;
  targetPrice: number | null;
  originalPrice: number;
  active: boolean;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDollarInput(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const cents = Math.min(parseInt(digits, 10), 99_999_999);
  return (cents / 100).toFixed(2);
}

function dollarsToCents(formatted: string): number {
  const n = parseFloat(formatted);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export function PriceAlertModal({
  visible,
  onClose,
  storeItemId,
  storeItemTitle,
  currentPrice,
}: PriceAlertModalProps) {
  const { member } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [existingAlert, setExistingAlert] = useState<ExistingAlert | null>(null);
  const [targetPriceDollars, setTargetPriceDollars] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (visible && member) {
      setLoading(true);
      apiGet<ExistingAlert | null>(`/api/price-alerts?storeItemId=${storeItemId}`)
        .then((data) => {
          setExistingAlert(data);
          if (data?.targetPrice) {
            setTargetPriceDollars((data.targetPrice / 100).toFixed(2));
          } else {
            setTargetPriceDollars("");
          }
        })
        .catch(() => setExistingAlert(null))
        .finally(() => setLoading(false));
    }
  }, [visible, member, storeItemId]);

  const handleSave = async () => {
    const targetCents = targetPriceDollars ? dollarsToCents(targetPriceDollars) : undefined;
    
    if (targetCents !== undefined && targetCents >= currentPrice) {
      Alert.alert("Invalid Price", "Target price must be lower than the current price.");
      return;
    }

    setSaving(true);
    try {
      const result = await apiPost<ExistingAlert>("/api/price-alerts", {
        storeItemId,
        targetPrice: targetCents,
      });
      setExistingAlert(result);
      Alert.alert(
        "Alert Created",
        targetCents
          ? `We'll notify you when the price drops to ${formatPrice(targetCents)} or below.`
          : "We'll notify you when the price drops."
      );
      onClose();
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to create alert");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingAlert) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/price-alerts/${existingAlert.id}`);
      setExistingAlert(null);
      setTargetPriceDollars("");
      Alert.alert("Alert Removed", "You will no longer receive price drop notifications for this item.");
      onClose();
    } catch {
      Alert.alert("Error", "Failed to remove alert");
    } finally {
      setDeleting(false);
    }
  };

  if (!member) {
    return (
      <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.content} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.title}>Price Drop Alert</Text>
            <View style={styles.signInContainer}>
              <Text style={styles.signInText}>
                Sign in to receive price drop notifications.
              </Text>
              <Pressable
                style={styles.signInBtn}
                onPress={() => {
                  onClose();
                  router.push("/(tabs)/my-community");
                }}
              >
                <Text style={styles.signInBtnText}>Sign In</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.content} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>Price Drop Alert</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={theme.colors.heading} />
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
            </View>
          ) : (
            <>
              <Text style={styles.itemTitle} numberOfLines={2}>
                {storeItemTitle}
              </Text>
              <Text style={styles.currentPriceLabel}>
                Current price: <Text style={styles.currentPrice}>{formatPrice(currentPrice)}</Text>
              </Text>

              {existingAlert?.active ? (
                <View style={styles.existingAlertBox}>
                  <Ionicons name="notifications" size={24} color={theme.colors.primary} />
                  <View style={styles.existingAlertInfo}>
                    <Text style={styles.existingAlertText}>
                      Alert active
                      {existingAlert.targetPrice
                        ? ` for ${formatPrice(existingAlert.targetPrice)} or below`
                        : " for any price drop"}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.inputSection}>
                <Text style={styles.inputLabel}>
                  Target price (optional)
                </Text>
                <View style={styles.inputRow}>
                  <Text style={styles.dollarSign}>$</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Any drop"
                    placeholderTextColor="#999"
                    keyboardType="decimal-pad"
                    value={targetPriceDollars}
                    onChangeText={(t) => setTargetPriceDollars(formatDollarInput(t))}
                  />
                </View>
                <Text style={styles.inputHint}>
                  Leave blank to be notified of any price drop.
                </Text>
              </View>

              <View style={styles.actions}>
                {existingAlert?.active && (
                  <Pressable
                    style={[styles.deleteBtn, deleting && { opacity: 0.6 }]}
                    onPress={handleDelete}
                    disabled={deleting || saving}
                  >
                    {deleting ? (
                      <ActivityIndicator size="small" color={theme.colors.primary} />
                    ) : (
                      <Text style={styles.deleteBtnText}>Remove Alert</Text>
                    )}
                  </Pressable>
                )}
                <Pressable
                  style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                  onPress={handleSave}
                  disabled={saving || deleting}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.saveBtnText}>
                      {existingAlert?.active ? "Update Alert" : "Set Alert"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  content: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  closeBtn: {
    padding: 4,
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: "center",
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: "500",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  currentPriceLabel: {
    fontSize: 14,
    color: theme.colors.text,
    marginBottom: 16,
  },
  currentPrice: {
    fontWeight: "700",
    color: theme.colors.primary,
  },
  existingAlertBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.creamAlt,
    marginBottom: 16,
  },
  existingAlertInfo: {
    flex: 1,
  },
  existingAlertText: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.heading,
  },
  inputSection: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 2,
    borderColor: theme.colors.cream,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  dollarSign: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginRight: 4,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 18,
    color: theme.colors.text,
  },
  inputHint: {
    fontSize: 12,
    color: theme.colors.text,
    marginTop: 6,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  deleteBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    minWidth: 100,
    alignItems: "center",
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  saveBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    minWidth: 100,
    alignItems: "center",
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  signInContainer: {
    padding: 32,
    alignItems: "center",
  },
  signInText: {
    fontSize: 14,
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 16,
  },
  signInBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  signInBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});
