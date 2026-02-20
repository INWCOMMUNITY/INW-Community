import { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

interface PointsEarnedPopupProps {
  visible: boolean;
  onClose: () => void;
  businessName: string;
  pointsAwarded: number;
  previousTotal: number;
  newTotal: number;
}

export function PointsEarnedPopup({
  visible,
  onClose,
  businessName,
  pointsAwarded,
  previousTotal,
  newTotal,
}: PointsEarnedPopupProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const [displayPoints, setDisplayPoints] = useState(previousTotal);
  const counterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      scaleAnim.setValue(0);
      setDisplayPoints(previousTotal);
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 5,
        tension: 60,
        useNativeDriver: true,
      }).start();

      const delay = setTimeout(() => {
        const duration = 1500;
        const steps = 30;
        const increment = (newTotal - previousTotal) / steps;
        let current = previousTotal;
        let step = 0;

        counterRef.current = setInterval(() => {
          step++;
          current += increment;
          if (step >= steps) {
            setDisplayPoints(newTotal);
            if (counterRef.current) clearInterval(counterRef.current);
          } else {
            setDisplayPoints(Math.round(current));
          }
        }, duration / steps);
      }, 400);

      return () => {
        clearTimeout(delay);
        if (counterRef.current) clearInterval(counterRef.current);
      };
    }
  }, [visible, previousTotal, newTotal, scaleAnim]);

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.card,
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          <Pressable style={styles.closeBtn} onPress={onClose}>
            <Ionicons name="close" size={24} color="#666" />
          </Pressable>

          <View style={styles.iconWrap}>
            <Ionicons name="star" size={56} color={theme.colors.primary} />
          </View>

          <Text style={styles.congrats}>Points Earned!</Text>

          <Text style={styles.awarded}>+{pointsAwarded}</Text>

          <Text style={styles.message}>
            You have earned {pointsAwarded} points for supporting{" "}
            <Text style={styles.businessName}>{businessName}</Text>.{"\n"}
            Thanks for supporting local businesses!
          </Text>

          <View style={styles.totalWrap}>
            <Text style={styles.totalLabel}>Your Total</Text>
            <Text style={styles.totalValue}>{displayPoints} pts</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.8 }]}
            onPress={onClose}
          >
            <Text style={styles.doneBtnText}>Awesome!</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  card: {
    width: Math.min(Dimensions.get("window").width - 48, 360),
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 3,
    borderColor: theme.colors.primary,
    padding: 28,
    alignItems: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    padding: 4,
    zIndex: 10,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: `${theme.colors.primary}20`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  congrats: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  awarded: {
    fontSize: 36,
    fontWeight: "800",
    color: theme.colors.primary,
    marginBottom: 12,
  },
  message: {
    fontSize: 15,
    color: "#555",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  businessName: {
    fontWeight: "700",
    color: theme.colors.heading,
  },
  totalWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: `${theme.colors.primary}15`,
    marginBottom: 20,
    width: "100%",
    justifyContent: "center",
  },
  totalLabel: {
    fontSize: 14,
    color: "#666",
  },
  totalValue: {
    fontSize: 24,
    fontWeight: "700",
    color: theme.colors.primary,
  },
  doneBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 40,
    borderRadius: 8,
    width: "100%",
    alignItems: "center",
  },
  doneBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
