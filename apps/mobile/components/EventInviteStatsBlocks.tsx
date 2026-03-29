import { View, Text, StyleSheet } from "react-native";
import { theme } from "@/lib/theme";
import type { EventInviteStats } from "@/lib/events-api";

type Props = {
  stats: EventInviteStats;
  /** Tighter typography for dense lists (e.g. calendar). */
  compact?: boolean;
};

const ROW = [
  { key: "sent", label: "Invites" },
  { key: "attending", label: "Going" },
  { key: "maybe", label: "Maybe" },
  { key: "declined", label: "Can't go" },
] as const;

export function EventInviteStatsBlocks({ stats, compact }: Props) {
  return (
    <View style={styles.row}>
      {ROW.map(({ key, label }) => {
        const value = stats[key];
        return (
          <View
            key={key}
            style={[styles.block, compact && styles.blockCompact]}
            accessibilityLabel={`${label}: ${value}`}
          >
            <Text style={[styles.value, compact && styles.valueCompact]}>{value}</Text>
            <Text style={[styles.blockLabel, compact && styles.labelCompact]} numberOfLines={2}>
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    marginTop: 10,
    width: "100%",
  },
  block: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 72,
    borderRadius: 8,
    backgroundColor: theme.colors.cream,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  blockCompact: {
    maxHeight: 64,
  },
  value: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.heading,
  },
  valueCompact: {
    fontSize: 15,
  },
  blockLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#5a6570",
    textAlign: "center",
    marginTop: 2,
    lineHeight: 12,
  },
  labelCompact: {
    fontSize: 9,
    lineHeight: 11,
  },
});
