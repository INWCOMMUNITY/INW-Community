import { useEffect, useRef } from "react";
import { StyleSheet, View, Animated, Easing } from "react-native";
import { theme } from "@/lib/theme";

export function FriendCardSkeleton() {
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
    <View style={styles.card}>
      <Animated.View style={[styles.avatar, { opacity }]} />
      <View style={styles.textArea}>
        <Animated.View style={[styles.nameLine, { opacity }]} />
        <Animated.View style={[styles.subLine, { opacity }]} />
      </View>
    </View>
  );
}

export function FriendListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => (
        <FriendCardSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#e0e0e0",
  },
  textArea: {
    flex: 1,
    marginLeft: 12,
    gap: 6,
  },
  nameLine: {
    height: 16,
    width: "60%",
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
  },
  subLine: {
    height: 12,
    width: "40%",
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
  },
});
