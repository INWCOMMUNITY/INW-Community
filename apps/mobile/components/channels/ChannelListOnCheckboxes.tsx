import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import {
  CHANNEL_PROVIDER_LABEL,
  channelNotReadyHint,
  listOnConnections,
  type ChannelConnectionSummary,
  type ChannelProviderId,
} from "@/lib/channel-connections";

type Props = {
  connections: ChannelConnectionSummary[];
  selected: ChannelProviderId[];
  onChange: (next: ChannelProviderId[]) => void;
  disabled?: boolean;
};

export function ChannelListOnCheckboxes({ connections, selected, onChange, disabled }: Props) {
  const router = useRouter();
  const rows = listOnConnections(connections);

  function toggle(provider: ChannelProviderId, blocked: boolean) {
    if (blocked || disabled) return;
    if (selected.includes(provider)) {
      onChange(selected.filter((p) => p !== provider));
      return;
    }
    onChange([...selected, provider]);
  }

  if (rows.length === 0) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Where Else to List?</Text>
        <Text style={styles.subtitle}>Only stores you have connected in Sync Stores.</Text>
        <Pressable onPress={() => router.push("/seller-hub/channels")}>
          <Text style={styles.link}>Connect stores in Sync Stores</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Where Else to List?</Text>
      <Text style={styles.subtitle}>Choose other places to publish. Uncheck any store to skip.</Text>
      {rows.map((c) => {
        const needsReconnect = c.status === "error";
        const blocked = needsReconnect || c.readyToPublish === false;
        const reason = blocked ? c.publishBlockReason || channelNotReadyHint(c.provider) : null;
        const checked = !blocked && selected.includes(c.provider);
        const label = CHANNEL_PROVIDER_LABEL[c.provider] ?? c.provider;
        return (
          <Pressable
            key={c.id}
            style={[styles.row, (blocked || disabled) && styles.rowDisabled]}
            onPress={() => {
              if (needsReconnect) {
                router.push("/seller-hub/channels");
                return;
              }
              toggle(c.provider, blocked);
            }}
            disabled={disabled || (blocked && !needsReconnect)}
          >
            <View style={[styles.box, checked && styles.boxChecked]}>
              {checked ? <Text style={styles.check}>✓</Text> : null}
            </View>
            <View style={styles.body}>
              <Text style={[styles.label, (blocked || disabled) && styles.labelDisabled]}>
                List on {label}
              </Text>
              {c.shopName ? <Text style={styles.hint}>{c.shopName}</Text> : null}
              {reason ? <Text style={styles.hint}>{reason}</Text> : null}
              {needsReconnect ? <Text style={styles.link}>Reconnect in Sync Stores</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: theme.colors.heading },
  subtitle: { fontSize: 13, color: theme.colors.labelMuted, marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 6 },
  rowDisabled: { opacity: 0.65 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: "#d1d5db",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    backgroundColor: "#fff",
  },
  boxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  check: { color: "#fff", fontSize: 13, fontWeight: "700", lineHeight: 16 },
  body: { flex: 1 },
  label: { fontSize: 15, fontWeight: "600", color: theme.colors.heading },
  labelDisabled: { color: theme.colors.labelMuted },
  hint: { fontSize: 12, color: theme.colors.labelMuted, marginTop: 2 },
  link: { fontSize: 13, fontWeight: "600", color: theme.colors.primary, marginTop: 4 },
});
