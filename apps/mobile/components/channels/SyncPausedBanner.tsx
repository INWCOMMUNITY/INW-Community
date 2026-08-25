import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import type { ChannelHealthKind } from "@/lib/channel-connections";

export type SyncPausedConnection = {
  id: string;
  provider: string;
  status: string;
  lastError: string | null;
  healthKind?: ChannelHealthKind | null;
  healthMessage?: string | null;
};

const PROVIDER_NAMES: Record<string, string> = {
  etsy: "Etsy",
  ebay: "eBay",
  wix: "Wix",
  shopify: "Shopify",
};

type Props = {
  connections: SyncPausedConnection[];
  onReconnect: (provider: string) => void;
  onShowGuide?: (provider: string) => void;
  reconnecting: string | null;
};

function kindFor(conn: SyncPausedConnection): ChannelHealthKind {
  if (conn.healthKind && conn.healthKind !== "ok") return conn.healthKind;
  return conn.status === "error" ? "reconnect" : "ok";
}

function titleFor(kinds: ChannelHealthKind[]): string {
  if (kinds.every((k) => k === "platform_key")) return "Platform key issue";
  if (kinds.every((k) => k === "delayed")) return "Sync delayed";
  if (kinds.includes("platform_key") && !kinds.includes("reconnect")) return "Sync needs attention";
  if (kinds.every((k) => k === "reconnect" || k === "delayed" || k === "platform_key") && !kinds.includes("reconnect")) {
    return "Sync delayed";
  }
  return kinds.includes("reconnect") && kinds.every((k) => k === "reconnect") ? "Reconnect needed" : "Sync paused";
}

/**
 * Shown when one or more channel connections are in error state.
 * Reconnect vs delayed vs platform key — do not tell sellers to reconnect a platform-key failure.
 */
export function SyncPausedBanner({ connections, onReconnect, onShowGuide, reconnecting }: Props) {
  const errored = connections.filter((c) => c.status === "error");
  if (errored.length === 0) return null;

  const kinds = errored.map(kindFor);
  const names = errored
    .map((c) => PROVIDER_NAMES[c.provider] ?? c.provider)
    .join(", ");

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <View style={styles.headerRow}>
        <Ionicons name="pause-circle" size={22} color="#b45309" />
        <Text style={styles.title}>{titleFor(kinds)}</Text>
      </View>
      <Text style={styles.body}>
        Your INW quantities are unchanged. {names} may show outdated stock until sync recovers.
        Sales on Etsy, eBay, Wix, or Shopify are fulfilled on those marketplaces — not with INW Shippo labels.
      </Text>
      {errored.map((conn) => {
        const label = PROVIDER_NAMES[conn.provider] ?? conn.provider;
        const kind = kindFor(conn);
        const detail = conn.healthMessage || conn.lastError;
        return (
          <View key={conn.id} style={styles.providerBlock}>
            {detail ? (
              <Text style={styles.errorDetail} numberOfLines={4}>
                {label}: {detail}
              </Text>
            ) : null}
            {kind === "reconnect" ? (
              <Pressable
                style={({ pressed }) => [
                  styles.reconnectBtn,
                  pressed && { opacity: 0.85 },
                  reconnecting === conn.provider && styles.reconnectBtnDisabled,
                ]}
                onPress={() => onReconnect(conn.provider)}
                disabled={reconnecting === conn.provider}
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.reconnectBtnText}>
                  {reconnecting === conn.provider ? "Connecting…" : `Reconnect ${label}`}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.kindNote}>
                {kind === "platform_key"
                  ? "Do not reconnect — contact support about the platform encryption key."
                  : "Sync is retrying automatically. You do not need to reconnect yet."}
              </Text>
            )}
            {kind === "reconnect" && onShowGuide ? (
              <Pressable
                style={({ pressed }) => [styles.guideBtn, pressed && { opacity: 0.85 }]}
                onPress={() => onShowGuide(conn.provider)}
              >
                <Text style={styles.guideBtnText}>Show reconnect steps</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#fffbeb",
    borderWidth: 1,
    borderColor: "#fcd34d",
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: "#92400e",
  },
  body: {
    fontSize: 14,
    color: "#78350f",
    lineHeight: 20,
    marginBottom: 12,
  },
  providerBlock: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#fde68a",
  },
  errorDetail: {
    fontSize: 12,
    color: "#991b1b",
    marginBottom: 8,
    lineHeight: 17,
  },
  kindNote: {
    fontSize: 13,
    color: "#78350f",
    lineHeight: 18,
  },
  reconnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  reconnectBtnDisabled: {
    opacity: 0.6,
  },
  reconnectBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  guideBtn: {
    alignItems: "center",
    paddingVertical: 8,
    marginTop: 6,
  },
  guideBtnText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: "600",
  },
});
