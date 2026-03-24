import { useEffect, useRef, useState, useCallback } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
  AccessibilityInfo,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  coupon: "pricetag",
  badges: "ribbon",
  store: "cart",
  qr: "qr-code-outline",
};

export type PointsEarnedCategory = keyof typeof CATEGORY_ICONS;

const COUNTER_MS = 1500;
const COUNTER_STEPS = 30;
const BEAT_MS = 200;
const TAIL_MS = 800;
const TAIL_STEPS = 16;

interface PointsEarnedPopupProps {
  visible: boolean;
  onClose: () => void;
  businessName: string;
  pointsAwarded: number;
  previousTotal: number;
  newTotal: number;
  category?: PointsEarnedCategory;
  icon?: keyof typeof Ionicons.glyphMap;
  message?: string;
  buttonText?: string;
  /** 2× slam on points earned only (paid plans on store / scan). Caller sets from member.hasPaidSubscription. */
  applyDoubleMultiplierAnimation?: boolean;
}

export function PointsEarnedPopup({
  visible,
  onClose,
  businessName,
  pointsAwarded,
  previousTotal,
  newTotal,
  category,
  icon,
  message,
  buttonText,
  applyDoubleMultiplierAnimation = false,
}: PointsEarnedPopupProps) {
  const resolvedIcon = icon ?? (category ? CATEGORY_ICONS[category] : undefined) ?? "star";
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const bubbleTranslateY = useRef(new Animated.Value(-100)).current;
  const bubbleScale = useRef(new Animated.Value(0.65)).current;
  const bubbleOpacity = useRef(new Animated.Value(0)).current;
  const awardedShakeX = useRef(new Animated.Value(0)).current;

  const [displayPoints, setDisplayPoints] = useState(previousTotal);
  const [displayAwarded, setDisplayAwarded] = useState(pointsAwarded);
  const [messagePoints, setMessagePoints] = useState(pointsAwarded);
  const [showBubble, setShowBubble] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const counterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRefs = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearCounter = useCallback(() => {
    if (counterRef.current) {
      clearInterval(counterRef.current);
      counterRef.current = null;
    }
  }, []);

  const clearTimeouts = useCallback(() => {
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
  }, []);

  const pushTimeout = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timeoutRefs.current = timeoutRefs.current.filter((t) => t !== id);
      fn();
    }, ms);
    timeoutRefs.current.push(id);
    return id;
  }, []);

  useEffect(() => {
    let cancelled = false;
    try {
      const p = AccessibilityInfo.isReduceMotionEnabled();
      if (p != null && typeof (p as Promise<boolean>).then === "function") {
        (p as Promise<boolean>)
          .then((v) => {
            if (!cancelled) setReduceMotion(!!v);
          })
          .catch(() => {
            if (!cancelled) setReduceMotion(false);
          });
      }
    } catch {
      setReduceMotion(false);
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!visible) return;

    const useDouble =
      applyDoubleMultiplierAnimation &&
      !reduceMotion &&
      pointsAwarded >= 2 &&
      pointsAwarded % 2 === 0;

    const baseHalf = Math.floor(pointsAwarded / 2);
    const afterAwardTotal = previousTotal + pointsAwarded;

    const initialEarned = useDouble ? 0 : pointsAwarded;

    scaleAnim.setValue(0);
    bubbleOpacity.setValue(0);
    bubbleTranslateY.setValue(-100);
    bubbleScale.setValue(0.65);
    awardedShakeX.setValue(0);
    setShowBubble(false);
    setDisplayPoints(previousTotal);
    setDisplayAwarded(initialEarned);
    setMessagePoints(initialEarned);

    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 5,
      tension: 60,
      useNativeDriver: true,
    }).start();

    const runCounter = (
      from: number,
      to: number,
      durationMs: number,
      steps: number,
      onDone: () => void,
      setValue: (n: number) => void
    ) => {
      clearCounter();
      if (from === to) {
        setValue(to);
        onDone();
        return;
      }
      const increment = (to - from) / steps;
      let step = 0;
      let current = from;
      counterRef.current = setInterval(() => {
        step++;
        current += increment;
        if (step >= steps) {
          setValue(to);
          clearCounter();
          onDone();
        } else {
          setValue(Math.round(current));
        }
      }, durationMs / steps);
    };

    const runTotalCounter = (
      from: number,
      to: number,
      durationMs: number,
      steps: number,
      onDone: () => void
    ) => {
      runCounter(from, to, durationMs, steps, onDone, setDisplayPoints);
    };

    const runEarnedCounter = (
      from: number,
      to: number,
      durationMs: number,
      steps: number,
      onDone: () => void
    ) => {
      runCounter(from, to, durationMs, steps, onDone, (n) => {
        setDisplayAwarded(n);
        setMessagePoints(n);
      });
    };

    const runTail = (from: number, to: number, onDone: () => void) => {
      runTotalCounter(from, to, TAIL_MS, TAIL_STEPS, onDone);
    };

    const shakeAwarded = (onDone: () => void) => {
      awardedShakeX.setValue(0);
      Animated.sequence([
        Animated.timing(awardedShakeX, { toValue: 10, duration: 45, useNativeDriver: true }),
        Animated.timing(awardedShakeX, { toValue: -10, duration: 45, useNativeDriver: true }),
        Animated.timing(awardedShakeX, { toValue: 5, duration: 35, useNativeDriver: true }),
        Animated.timing(awardedShakeX, { toValue: 0, duration: 35, useNativeDriver: true }),
      ]).start(() => onDone());
    };

    const playBubbleSlam = (onDone: () => void) => {
      setShowBubble(true);
      bubbleOpacity.setValue(1);
      bubbleTranslateY.setValue(-110);
      bubbleScale.setValue(0.65);
      Animated.parallel([
        Animated.timing(bubbleTranslateY, {
          toValue: 0,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(bubbleScale, {
            toValue: 1.18,
            duration: 180,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(bubbleScale, {
            toValue: 1,
            friction: 5,
            tension: 120,
            useNativeDriver: true,
          }),
        ]),
      ]).start(() => {
        setDisplayAwarded(pointsAwarded);
        setMessagePoints(pointsAwarded);
        shakeAwarded(() => {
          setShowBubble(false);
          bubbleOpacity.setValue(0);
          runTotalCounter(previousTotal, afterAwardTotal, COUNTER_MS, COUNTER_STEPS, () => {
            if (newTotal > afterAwardTotal) {
              runTail(afterAwardTotal, newTotal, () => {});
            }
            onDone();
          });
        });
      });
    };

    pushTimeout(() => {
      if (reduceMotion || !useDouble) {
        runTotalCounter(previousTotal, newTotal, COUNTER_MS, COUNTER_STEPS, () => {});
        return;
      }

      runEarnedCounter(0, baseHalf, COUNTER_MS, COUNTER_STEPS, () => {
        pushTimeout(() => playBubbleSlam(() => {}), BEAT_MS);
      });
    }, 400);

    return () => {
      clearTimeouts();
      clearCounter();
    };
  }, [
    visible,
    previousTotal,
    newTotal,
    pointsAwarded,
    applyDoubleMultiplierAnimation,
    reduceMotion,
    scaleAnim,
    bubbleTranslateY,
    bubbleScale,
    bubbleOpacity,
    clearCounter,
    clearTimeouts,
    pushTimeout,
  ]);

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
            <Ionicons name={resolvedIcon} size={56} color={theme.colors.primary} />
          </View>

          <Text style={styles.congrats}>Points Earned!</Text>

          <View style={styles.awardedArea}>
            {showBubble && (
              <Animated.View
                style={[
                  styles.bubble,
                  {
                    opacity: bubbleOpacity,
                    transform: [{ translateY: bubbleTranslateY }, { scale: bubbleScale }],
                  },
                ]}
                pointerEvents="none"
              >
                <Text style={styles.bubbleText}>2×</Text>
              </Animated.View>
            )}
            <Animated.View style={{ transform: [{ translateX: awardedShakeX }] }}>
              <Text style={styles.awarded}>+{displayAwarded}</Text>
            </Animated.View>
          </View>

          <Text style={styles.message}>
            {message ?? (
              <>
                You have earned {messagePoints} points for supporting{" "}
                <Text style={styles.businessName}>{businessName}</Text>.{"\n"}
                Thanks for supporting local businesses!
              </>
            )}
          </Text>

          <View style={styles.totalWrap}>
            <Text style={styles.totalLabel}>Your Total</Text>
            <Text style={styles.totalValue}>{displayPoints} pts</Text>
          </View>

          <Pressable
            style={({ pressed }) => [styles.doneBtn, pressed && { opacity: 0.8 }]}
            onPress={onClose}
          >
            <Text style={styles.doneBtnText}>{buttonText ?? "Awesome!"}</Text>
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
  awardedArea: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 56,
    marginBottom: 12,
    width: "100%",
    position: "relative",
  },
  bubble: {
    position: "absolute",
    top: -8,
    alignSelf: "center",
    backgroundColor: "#16a34a",
    borderWidth: 3,
    borderColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    zIndex: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 6,
  },
  bubbleText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  awarded: {
    fontSize: 36,
    fontWeight: "800",
    color: theme.colors.primary,
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
