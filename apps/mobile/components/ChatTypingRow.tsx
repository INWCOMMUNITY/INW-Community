import { useEffect, useRef } from "react";
import { View, Image, Text, StyleSheet, Animated, Platform } from "react-native";
import { theme } from "@/lib/theme";

export type ChatTypingPeer = { id: string; name: string; photoUrl: string | null };

function BouncingDot({
  delayMs,
  color,
}: {
  delayMs: number;
  color: string;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const useNativeDriver = Platform.OS !== "web";
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(translateY, {
          toValue: -4,
          duration: 320,
          delay: delayMs,
          useNativeDriver,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 320,
          useNativeDriver,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delayMs, translateY, useNativeDriver]);
  return (
    <Animated.View
      style={[
        styles.dotBase,
        {
          backgroundColor: color,
          transform: [{ translateY }],
        },
      ]}
    />
  );
}

type Variant = "banner" | "inline";

/**
 * Remote typing: avatar(s) on the left + dots (same side as incoming messages).
 * No extra horizontal inset — message list padding already matches bubbles.
 */
export function ChatTypingRow({ peers, variant = "inline" }: { peers: ChatTypingPeer[]; variant?: Variant }) {
  if (peers.length === 0) return null;
  const label =
    peers.length === 1
      ? `${peers[0].name} is typing`
      : `${peers.length} people are typing`;
  const primary = theme.colors.primary;
  const dotColor = variant === "inline" ? primary : "#555";

  if (variant === "inline") {
    return (
      <View
        style={styles.incomingWrap}
        accessibilityRole="text"
        accessibilityLabel={label}
      >
        <View style={styles.inlineAvatarSlot}>
          {peers.slice(0, 3).map((p, i) => (
            <View
              key={p.id}
              style={[styles.inlineAvatarRing, i > 0 && styles.inlineAvatarOverlap]}
            >
              {p.photoUrl ? (
                <Image source={{ uri: p.photoUrl }} style={styles.inlineAvatar} />
              ) : (
                <View style={[styles.inlineAvatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarLetter}>
                    {(p.name.trim()[0] || "?").toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
          ))}
        </View>
        <View style={styles.incomingBubble}>
          <BouncingDot delayMs={0} color={dotColor} />
          <BouncingDot delayMs={110} color={dotColor} />
          <BouncingDot delayMs={220} color={dotColor} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.bannerWrap} accessibilityRole="text" accessibilityLabel={label}>
      <View style={styles.avatarStack}>
        {peers.slice(0, 3).map((p, i) => (
          <View key={p.id} style={[styles.bannerAvatarRing, i > 0 && styles.avatarOverlap]}>
            {p.photoUrl ? (
              <Image source={{ uri: p.photoUrl }} style={styles.bannerAvatar} />
            ) : (
              <View style={[styles.bannerAvatar, styles.avatarPlaceholder]}>
                <Text style={styles.bannerAvatarLetter}>
                  {(p.name.trim()[0] || "?").toUpperCase()}
                </Text>
              </View>
            )}
          </View>
        ))}
      </View>
      <View style={styles.bannerBubble}>
        <BouncingDot delayMs={0} color={dotColor} />
        <BouncingDot delayMs={120} color={dotColor} />
        <BouncingDot delayMs={240} color={dotColor} />
      </View>
    </View>
  );
}

/**
 * Incoming row: avatars share one slot (typing peers first, then presence-only).
 * Typing dots while the other person has the composer focused (keyboard session), not per keypress.
 */
export function ChatIncomingActivityFooter({
  typingPeers,
  presenceOnlyPeers,
}: {
  typingPeers: ChatTypingPeer[];
  presenceOnlyPeers: ChatTypingPeer[];
}) {
  const typingIds = new Set(typingPeers.map((p) => p.id));
  const presenceExtra = presenceOnlyPeers.filter((p) => !typingIds.has(p.id));
  const avatarPeers = [...typingPeers, ...presenceExtra];
  if (avatarPeers.length === 0) return null;

  const showDots = typingPeers.length > 0;
  const primary = theme.colors.primary;
  const dotColor = primary;
  const a11yLabel =
    showDots && typingPeers.length === 1
      ? `${typingPeers[0].name} is typing`
      : showDots
        ? `${typingPeers.length} people are typing`
        : undefined;

  return (
    <View style={styles.activityFooterColumn}>
      <View
        style={styles.incomingWrap}
        {...(showDots ? { accessibilityRole: "text" as const, accessibilityLabel: a11yLabel } : {})}
      >
        <View style={styles.inlineAvatarSlot}>
          {avatarPeers.slice(0, 3).map((p, i) => (
            <View key={p.id} style={[styles.inlineAvatarRing, i > 0 && styles.inlineAvatarOverlap]}>
              {p.photoUrl ? (
                <Image source={{ uri: p.photoUrl }} style={styles.inlineAvatar} />
              ) : (
                <View style={[styles.inlineAvatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarLetter}>{(p.name.trim()[0] || "?").toUpperCase()}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
        {showDots ? (
          <View style={styles.incomingBubble}>
            <BouncingDot delayMs={0} color={dotColor} />
            <BouncingDot delayMs={110} color={dotColor} />
            <BouncingDot delayMs={220} color={dotColor} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Read receipt; keep last in the footer so it sits tight under the conversation tail. */
export function ChatSeenLine({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Text style={styles.seenTight} accessibilityLabel="Seen">
      Seen
    </Text>
  );
}

/** Your typing preview while the composer is focused / keyboard is up (outgoing / right). */
export function LocalComposerTypingPreview({ peer }: { peer: ChatTypingPeer }) {
  return (
    <View style={styles.outgoingWrap} accessibilityRole="text" accessibilityLabel="You are composing a message">
      <View style={styles.outgoingRow}>
        <View style={styles.outgoingAvatarRing}>
          {peer.photoUrl ? (
            <Image source={{ uri: peer.photoUrl }} style={styles.outgoingAvatar} />
          ) : (
            <View style={[styles.outgoingAvatar, styles.avatarPlaceholder]}>
              <Text style={styles.outgoingAvatarLetter}>
                {(peer.name.trim()[0] || "?").toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.outgoingBubble}>
          <BouncingDot delayMs={0} color="#fff" />
          <BouncingDot delayMs={110} color="#fff" />
          <BouncingDot delayMs={220} color="#fff" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dotBase: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginHorizontal: 2,
  },
  incomingWrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-start",
    alignSelf: "stretch",
    marginBottom: 10,
    gap: 6,
  },
  outgoingWrap: {
    alignSelf: "stretch",
    alignItems: "flex-end",
    marginBottom: 4,
  },
  outgoingRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "flex-end",
    gap: 6,
    maxWidth: "88%",
  },
  outgoingBubble: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderBottomRightRadius: 4,
    borderBottomLeftRadius: 14,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
    minHeight: 34,
    minWidth: 52,
  },
  outgoingAvatarRing: {
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 15,
    overflow: "hidden",
    backgroundColor: theme.colors.cream,
  },
  outgoingAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.colors.cream ?? "#f5f5f5",
  },
  outgoingAvatarLetter: { fontSize: 11, fontWeight: "700", color: "#666" },
  inlineAvatarSlot: {
    flexDirection: "row",
  },
  inlineAvatarRing: {
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 15,
    overflow: "hidden",
    backgroundColor: theme.colors.cream,
  },
  inlineAvatarOverlap: { marginLeft: -6 },
  inlineAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: theme.colors.cream ?? "#f5f5f5",
  },
  incomingBubble: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderBottomLeftRadius: 4,
    backgroundColor: theme.colors.cream ?? "#f5f5f5",
    borderWidth: 2,
    borderColor: "#000",
    minHeight: 34,
    minWidth: 52,
  },
  bannerWrap: {
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
  bannerAvatarRing: {
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 22,
    overflow: "hidden",
  },
  avatarOverlap: { marginLeft: -10 },
  bannerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.cream ?? "#f5f5f5",
  },
  avatarPlaceholder: { alignItems: "center", justifyContent: "center" },
  avatarLetter: { fontSize: 11, fontWeight: "700", color: "#666" },
  bannerAvatarLetter: { fontSize: 13, fontWeight: "700", color: "#666" },
  bannerBubble: {
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
  activityFooterColumn: {
    alignSelf: "stretch",
    marginBottom: 4,
  },
  seenTight: {
    alignSelf: "flex-end",
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 2,
    marginBottom: 2,
    paddingHorizontal: 16,
    lineHeight: 14,
  },
});
