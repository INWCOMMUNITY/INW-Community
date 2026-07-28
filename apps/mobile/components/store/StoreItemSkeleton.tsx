import { useEffect, useRef } from "react";
import { StyleSheet, View, Animated, Easing } from "react-native";

interface StoreItemSkeletonProps {
  width: number;
}

export function StoreItemSkeleton({ width }: StoreItemSkeletonProps) {
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const shimmer = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    shimmer.start();
    return () => shimmer.stop();
  }, [shimmerAnim]);

  const shimmerTranslate = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, width],
  });

  return (
    <View style={[styles.card, { width }]}>
      <View style={styles.imageWrap}>
        <Animated.View
          style={[
            styles.shimmer,
            { transform: [{ translateX: shimmerTranslate }] },
          ]}
        />
      </View>
      <View style={styles.content}>
        <View style={styles.titleLine}>
          <Animated.View
            style={[
              styles.shimmer,
              { transform: [{ translateX: shimmerTranslate }] },
            ]}
          />
        </View>
        <View style={styles.titleLineShort}>
          <Animated.View
            style={[
              styles.shimmer,
              { transform: [{ translateX: shimmerTranslate }] },
            ]}
          />
        </View>
        <View style={styles.priceLine}>
          <Animated.View
            style={[
              styles.shimmer,
              { transform: [{ translateX: shimmerTranslate }] },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

interface StoreSkeletonGridProps {
  cardWidth: number;
  count?: number;
}

export function StoreSkeletonGrid({ cardWidth, count = 6 }: StoreSkeletonGridProps) {
  const pairs = [];
  for (let i = 0; i < count; i += 2) {
    pairs.push(i);
  }

  return (
    <View style={styles.grid}>
      {pairs.map((idx) => (
        <View key={idx} style={styles.row}>
          <StoreItemSkeleton width={cardWidth} />
          {idx + 1 < count && <StoreItemSkeleton width={cardWidth} />}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  imageWrap: {
    width: "100%",
    aspectRatio: 4 / 5,
    backgroundColor: "#e8e8e8",
    overflow: "hidden",
  },
  content: {
    padding: 8,
  },
  titleLine: {
    width: "80%",
    height: 14,
    backgroundColor: "#e8e8e8",
    borderRadius: 4,
    marginBottom: 6,
    overflow: "hidden",
  },
  titleLineShort: {
    width: "50%",
    height: 14,
    backgroundColor: "#e8e8e8",
    borderRadius: 4,
    marginBottom: 8,
    overflow: "hidden",
  },
  priceLine: {
    width: "40%",
    height: 18,
    backgroundColor: "#e8e8e8",
    borderRadius: 4,
    overflow: "hidden",
  },
  shimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "50%",
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  grid: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 32,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 12,
  },
});
