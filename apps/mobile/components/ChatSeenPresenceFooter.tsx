import { View, Text, Image, StyleSheet } from "react-native";
import type { ChatTypingPeer } from "@/components/ChatTypingRow";

export function ChatSeenPresenceFooter({
  showSeen,
  peers,
}: {
  showSeen: boolean;
  peers: ChatTypingPeer[];
}) {
  if (!showSeen && peers.length === 0) return null;

  return (
    <View style={styles.row}>
      {peers.map((p) => (
        <View key={p.id} style={styles.avatarWrap} accessibilityLabel={`${p.name} is in this chat`}>
          {p.photoUrl ? (
            <Image source={{ uri: p.photoUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPh]}>
              <Text style={styles.avatarLetter}>{(p.name.trim()[0] || "?").toUpperCase()}</Text>
            </View>
          )}
        </View>
      ))}
      {showSeen ? <Text style={styles.seen}>Seen</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    flexWrap: "wrap",
  },
  avatarWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#fff",
    backgroundColor: "#e5e5e5",
  },
  avatar: { width: "100%", height: "100%" },
  avatarPh: { alignItems: "center", justifyContent: "center" },
  avatarLetter: { fontSize: 10, fontWeight: "700", color: "#555" },
  seen: { fontSize: 12, color: "#9ca3af" },
});
