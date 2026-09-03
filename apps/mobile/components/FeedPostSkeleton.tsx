import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { theme } from "@/lib/theme";

const PULSE_DURATION = 900;

function usePulse() {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: PULSE_DURATION,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: PULSE_DURATION,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return opacity;
}

function SkeletonCard({ opacity }: { opacity: Animated.Value }) {
  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <Animated.View style={[styles.avatar, { opacity }]} />
        <View style={styles.headerText}>
          <Animated.View style={[styles.nameLine, { opacity }]} />
          <Animated.View style={[styles.dateLine, { opacity }]} />
        </View>
      </View>

      {/* Image area */}
      <Animated.View style={[styles.imageArea, { opacity }]} />

      {/* Action bar */}
      <View style={styles.actions}>
        <Animated.View style={[styles.actionPill, { opacity }]} />
        <Animated.View style={[styles.actionPill, { opacity }]} />
        <Animated.View style={[styles.actionPill, { opacity }]} />
      </View>
    </View>
  );
}

export function FeedPostSkeleton({ count = 3 }: { count?: number }) {
  const opacity = usePulse();

  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} opacity={opacity} />
      ))}
    </>
  );
}

const BONE = "#e5e5e5";

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.card,
    overflow: "hidden",
    marginHorizontal: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    ...theme.shadows.card,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: BONE,
  },
  headerText: {
    flex: 1,
    gap: 6,
  },
  nameLine: {
    height: 14,
    width: "60%",
    borderRadius: 4,
    backgroundColor: BONE,
  },
  dateLine: {
    height: 10,
    width: "35%",
    borderRadius: 4,
    backgroundColor: BONE,
  },
  imageArea: {
    width: "100%",
    height: 200,
    backgroundColor: BONE,
  },
  actions: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    paddingVertical: 8,
    paddingHorizontal: 8,
    gap: 8,
  },
  actionPill: {
    flex: 1,
    height: 28,
    borderRadius: 6,
    backgroundColor: BONE,
  },
});
