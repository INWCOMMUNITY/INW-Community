import { useEffect, useRef } from "react";
import { StyleSheet, View, Animated, Easing } from "react-native";
import { theme } from "@/lib/theme";

export function MemberProfileSkeleton() {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(shimmerAnim, {
          toValue: 0,
          duration: 1000,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  const opacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={styles.container}>
      {/* Cover photo placeholder */}
      <Animated.View style={[styles.coverPhoto, { opacity }]} />

      {/* Profile header */}
      <View style={styles.header}>
        <Animated.View style={[styles.avatar, { opacity }]} />
        <View style={styles.nameArea}>
          <Animated.View style={[styles.nameLine, { opacity }]} />
          <Animated.View style={[styles.cityLine, { opacity }]} />
        </View>
      </View>

      {/* Stats row */}
      <View style={styles.statsRow}>
        <Animated.View style={[styles.statBlock, { opacity }]} />
        <Animated.View style={[styles.statBlock, { opacity }]} />
        <Animated.View style={[styles.statBlock, { opacity }]} />
      </View>

      {/* Bio section */}
      <View style={styles.bioSection}>
        <Animated.View style={[styles.bioLine, { opacity }]} />
        <Animated.View style={[styles.bioLineShort, { opacity }]} />
      </View>

      {/* Badges section */}
      <View style={styles.badgesSection}>
        <View style={styles.badgesRow}>
          <Animated.View style={[styles.badgeCircle, { opacity }]} />
          <Animated.View style={[styles.badgeCircle, { opacity }]} />
          <Animated.View style={[styles.badgeCircle, { opacity }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  coverPhoto: {
    height: 140,
    backgroundColor: "#e0e0e0",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    marginTop: -40,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#e0e0e0",
    borderWidth: 3,
    borderColor: "#fff",
  },
  nameArea: {
    flex: 1,
    marginLeft: 16,
    marginTop: 40,
    gap: 8,
  },
  nameLine: {
    height: 22,
    width: "60%",
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
  },
  cityLine: {
    height: 14,
    width: "40%",
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  statBlock: {
    width: 70,
    height: 50,
    backgroundColor: "#e0e0e0",
    borderRadius: 8,
  },
  bioSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  bioLine: {
    height: 14,
    width: "100%",
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
  },
  bioLineShort: {
    height: 14,
    width: "70%",
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
  },
  badgesSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  badgesRow: {
    flexDirection: "row",
    gap: 12,
  },
  badgeCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#e0e0e0",
  },
});
