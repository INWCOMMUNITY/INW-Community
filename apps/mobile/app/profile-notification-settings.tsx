import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Switch,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Pressable,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme, switchIosBackgroundColor, switchThumbColor, switchTrackColor } from "@/lib/theme";
import { apiGet, apiPatch, getToken } from "@/lib/api";

type Prefs = {
  notifyBadges: boolean;
  notifyMessages: boolean;
  notifyComments: boolean;
  notifyEvents: boolean;
  notifyGroupAdmin: boolean;
  notifyCommerce: boolean;
  notifySocial: boolean;
};

const DEFAULT_PREFS: Prefs = {
  notifyBadges: true,
  notifyMessages: true,
  notifyComments: true,
  notifyEvents: true,
  notifyGroupAdmin: true,
  notifyCommerce: true,
  notifySocial: true,
};

function normalizePrefs(raw: unknown): Prefs | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const keys: (keyof Prefs)[] = [
    "notifyBadges",
    "notifyMessages",
    "notifyComments",
    "notifyEvents",
    "notifyGroupAdmin",
    "notifyCommerce",
    "notifySocial",
  ];
  const out: Partial<Prefs> = {};
  for (const k of keys) {
    if (typeof o[k] === "boolean") out[k] = o[k];
  }
  if (keys.every((k) => typeof out[k] === "boolean")) {
    return out as Prefs;
  }
  return null;
}

const ROWS: { key: keyof Prefs; label: string; description: string }[] = [
  {
    key: "notifyBadges",
    label: "Badge notifications",
    description: "When you or your business earns a new badge.",
  },
  {
    key: "notifyMessages",
    label: "Messages",
    description: "Direct messages and resale messages.",
  },
  {
    key: "notifyComments",
    label: "Comments",
    description: "Comments on your feed posts, business posts, blog, and replies to your comments.",
  },
  {
    key: "notifyEvents",
    label: "Events",
    description: "Invites, responses, and reminders for saved events.",
  },
  {
    key: "notifyGroupAdmin",
    label: "Group admin activity",
    description: "When a member posts in a group you admin.",
  },
  {
    key: "notifyCommerce",
    label: "Orders & marketplace",
    description: "Sales, shipping, offers, cart, reward redemptions, and new business favorites.",
  },
  {
    key: "notifySocial",
    label: "Social",
    description: "Friend requests.",
  },
];

export default function ProfileNotificationSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [syncedFromServer, setSyncedFromServer] = useState(true);

  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setLoading(false);
      Alert.alert("Sign in required", "Please sign in to manage notifications.");
      router.back();
      return;
    }
    try {
      const d = await apiGet<unknown>("/api/me/notification-preferences");
      const parsed = normalizePrefs(d);
      if (parsed) {
        setPrefs(parsed);
        setSyncedFromServer(true);
      } else {
        setPrefs(DEFAULT_PREFS);
        setSyncedFromServer(false);
      }
    } catch {
      setPrefs(DEFAULT_PREFS);
      setSyncedFromServer(false);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (key: keyof Prefs, value: boolean) => {
    if (!prefs) return;
    const prev = prefs[key];
    setPrefs({ ...prefs, [key]: value });
    setSavingKey(key);
    try {
      const d = await apiPatch<unknown>("/api/me/notification-preferences", { [key]: value });
      const parsed = normalizePrefs(d);
      if (parsed) {
        setPrefs(parsed);
        setSyncedFromServer(true);
      } else {
        setPrefs({ ...prefs, [key]: prev });
        Alert.alert(
          "Could not save",
          "The server did not accept this update. Check your connection, or try again after the latest app update is live."
        );
      }
    } catch {
      setPrefs({ ...prefs, [key]: prev });
      Alert.alert(
        "Could not save",
        "Check your connection. If your community recently added notification settings, you may need to wait until that update is deployed."
      );
    } finally {
      setSavingKey(null);
    }
  };

  if (loading || !prefs) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color={theme.colors.heading} />
        </Pressable>
        <Text style={styles.headerTitle}>Notification Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 12 }}
      >
        {!syncedFromServer ? (
          <View style={styles.banner}>
            <Ionicons name="information-circle-outline" size={22} color="#92400e" />
            <Text style={styles.bannerText}>
              Showing default choices here. Connect to the latest app server to load and save your
              personal notification preferences.
            </Text>
          </View>
        ) : null}
        <Text style={styles.intro}>
          Choose which push notifications we send to this device. You can change these anytime.
        </Text>
        {ROWS.map((row) => (
          <View key={row.key} style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Text style={styles.rowDesc}>{row.description}</Text>
            </View>
            <Switch
              value={prefs[row.key]}
              onValueChange={(v) => void toggle(row.key, v)}
              disabled={savingKey !== null}
              trackColor={switchTrackColor()}
              thumbColor={switchThumbColor(prefs[row.key])}
              ios_backgroundColor={switchIosBackgroundColor}
            />
          </View>
        ))}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#f8f9fa" },
  container: {
    flex: 1,
    backgroundColor: "#f8f9fa",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  backBtn: { padding: 8, width: 40 },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f8f9fa",
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    backgroundColor: "#fef3c7",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fcd34d",
  },
  bannerText: {
    flex: 1,
    fontSize: 14,
    color: "#78350f",
    lineHeight: 20,
  },
  intro: {
    fontSize: 15,
    color: "#444",
    lineHeight: 22,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: "#fff",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e5e5",
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111",
  },
  rowDesc: {
    fontSize: 13,
    color: "#666",
    marginTop: 4,
    lineHeight: 18,
  },
});
