import { useEffect, useRef } from "react";
import { View, Image, Text, StyleSheet, Animated } from "react-native";
import { theme } from "@/lib/theme";

export type ChatTypingPeer = { id: string; name: string; photoUrl: string | null };

function BouncingDot({ delayMs }: { delayMs: number }) {
  const translateY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -5,
          duration: 380,
          delay: delayMs,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 380,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delayMs, translateY]);
  return (
    <Animated.View
      style={[
        styles.dot,
        {
          transform: [{ translateY }],
        },
      ]}
    />
  );
}

/** Avatar stack + three bouncing dots (matches web ChatTypingIndicator). */
export function ChatTypingRow({ peers }: { peers: ChatTypingPeer[] }) {
  if (peers.length === 0) return null;
  const label =
    peers.length === 1
      ? `${peers[0].name} is actively typing`
      : `${peers.length} people are actively typing`;

  return (
    <View style={styles.wrap} accessibilityRole="text" accessibilityLabel={label}>
      <View style={styles.avatarStack}>
        {peers.slice(0, 3).map((p, i) => (
          <View key={p.id} style={[styles.avatarRing, i > 0 && styles.avatarOverlap]}>
            {p.photoUrl ? (
              <Image source={{ uri: p.photoUrl }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarLetter}>{(p.name.trim()[0] || "?").toUpperCase()}</Text>
              </View>
            )}
          </View>
        ))}
      </View>
      <View style={styles.bubble}>
        <BouncingDot delayMs={0} />
        <BouncingDot delayMs={120} />
        <BouncingDot delayMs={240} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#f0f0f0",
    borderBottomWidth: 1,
    borderBottomColor: "#e8e8e8",
  },
  avatarStack: { flexDirection: "row", marginRight: 4 },
  avatarRing: {
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 22,
    overflow: "hidden",
  },
  avatarOverlap: { marginLeft: -10 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.cream ?? "#f5f5f5",
  },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarLetter: { fontSize: 14, fontWeight: "700", color: "#666" },
  bubble: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: theme.colors.cream ?? "#f5f5f5",
    borderWidth: 2,
    borderColor: "rgba(0,0,0,0.12)",
    minHeight: 40,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#555",
    marginHorizontal: 3,
  },
});
