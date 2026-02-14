import { useState, useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiPost, apiDelete, getToken } from "@/lib/api";

interface HeartSaveButtonProps {
  type: "event" | "business" | "coupon" | "store_item";
  referenceId: string;
  initialSaved?: boolean;
  onSavedChange?: (saved: boolean) => void;
  size?: number;
}

export function HeartSaveButton({
  type,
  referenceId,
  initialSaved = false,
  onSavedChange,
  size = 24,
}: HeartSaveButtonProps) {
  const [saved, setSaved] = useState(initialSaved);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setSaved(initialSaved);
  }, [initialSaved]);

  async function handlePress() {
    const token = await getToken();
    if (!token) return;
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
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  return (
    <Pressable
      onPress={handlePress}
      disabled={loading}
      style={({ pressed }) => [styles.btn, pressed && { opacity: 0.7 }]}
      hitSlop={8}
    >
      <Ionicons
        name={saved ? "heart" : "heart-outline"}
        size={size}
        color={saved ? "#e74c3c" : "#999"}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { padding: 4 },
});
