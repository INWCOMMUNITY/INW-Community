import { useState, useEffect } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiPost, apiDelete, getToken } from "@/lib/api";
import { theme } from "@/lib/theme";

interface HeartSaveButtonProps {
  type: "event" | "business" | "coupon" | "store_item" | "reward";
  referenceId: string;
  initialSaved?: boolean;
  onSavedChange?: (saved: boolean) => void;
  /** When provided and user is not signed in, called on press instead of doing nothing */
  onRequireAuth?: () => void;
  size?: number;
}

export function HeartSaveButton({
  type,
  referenceId,
  initialSaved = false,
  onSavedChange,
  onRequireAuth,
  size = 24,
}: HeartSaveButtonProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved]);

  async function handlePress() {
    const token = await getToken();
    if (!token) {
      onRequireAuth?.();
      return;
    }
    setLoading(true);
    try {
      if (saved) {
        await apiDelete(
          `/api/saved?type=${encodeURIComponent(type)}&referenceId=${encodeURIComponent(referenceId)}`
        );
        setSaved(false);
        onSavedChange?.(false);
      } else {
        await apiPost("/api/saved", { type, referenceId });
        setSaved(true);
        onSavedChange?.(true);
      }
    } catch (e) {
      const err = e as { error?: string; status?: number };
      const msg =
        typeof err?.error === "string" && err.error.trim()
          ? err.error
          : "Could not update saved items. Try again.";
      Alert.alert("Save failed", msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={loading}
      style={({ pressed }) => [styles.btn, styles.btnTouchable, pressed && { opacity: 0.8 }]}
      hitSlop={8}
    >
      <Ionicons
        name={saved ? "heart" : "heart-outline"}
        size={size}
        color={saved ? theme.colors.cream : "#555"}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 4 },
  btnTouchable: {
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 14,
  },
});
