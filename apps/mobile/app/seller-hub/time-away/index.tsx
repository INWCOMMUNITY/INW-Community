import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { theme } from "@/lib/theme";
import { apiGet, apiPost, apiDelete } from "@/lib/api";

interface TimeAwayState {
  id: string;
  startAt: string;
  endAt: string;
  allowSalesThrough: string;
  isActive: boolean;
  itemsHidden: boolean;
}

interface TimeAwayResponse {
  timeAway: TimeAwayState | null;
}

export default function TimeAwayScreen() {
  const [timeAway, setTimeAway] = useState<TimeAwayState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startAt, setStartAt] = useState(() => new Date());
  const [endAt, setEndAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d;
  });
  const [showStart, setShowStart] = useState(false);
  const [showEnd, setShowEnd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<TimeAwayResponse>("/api/seller-hub/time-away")
      .then((res) => {
        const ta = res.timeAway;
        setTimeAway(ta ?? null);
        if (ta) {
          setStartAt(new Date(ta.startAt));
          setEndAt(new Date(ta.endAt));
        }
      })
      .catch(() => setTimeAway(null))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openDatePicker = (
    mode: "date" | "time",
    value: Date,
    onChange: (d: Date) => void,
    show: boolean,
    setShow: (s: boolean) => void
  ) => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value,
        mode,
        onChange: (_, d) => {
          if (d) onChange(d);
        },
      });
    } else {
      setShow(true);
    }
  };

  const handleSetTimeAway = async () => {
    if (endAt <= startAt) return;
    setSaving(true);
    try {
      await apiPost("/api/seller-hub/time-away", {
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      });
      load();
    } catch {
      // show error
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await apiDelete("/api/seller-hub/time-away");
      setTimeAway(null);
    } catch {
      // show error
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  if (loading && !timeAway) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Time Away</Text>
      <Text style={styles.hint}>
        Set dates when you won&apos;t be able to fulfill orders. Listings can stay visible for up to 14 days into your time away.
      </Text>

      {timeAway && (
        <View style={styles.current}>
          <Text style={styles.currentLabel}>Current time away</Text>
          <Text style={styles.currentDates}>
            {formatDate(new Date(timeAway.startAt))} – {formatDate(new Date(timeAway.endAt))}
          </Text>
          {timeAway.isActive && <Text style={styles.badge}>Active</Text>}
        </View>
      )}

      <Text style={styles.section}>Set or update</Text>
      <Pressable
        style={({ pressed }) => [styles.dateRow, pressed && { opacity: 0.8 }]}
        onPress={() => openDatePicker("date", startAt, setStartAt, showStart, setShowStart)}
      >
        <Text style={styles.dateLabel}>Start</Text>
        <Text style={styles.dateValue}>{formatDate(startAt)}</Text>
      </Pressable>
      {showStart && Platform.OS !== "android" && (
        <DateTimePicker
          value={startAt}
          mode="date"
          display="spinner"
          onChange={(_, d) => {
            if (d) setStartAt(d);
            setShowStart(false);
          }}
        />
      )}
      <Pressable
        style={({ pressed }) => [styles.dateRow, pressed && { opacity: 0.8 }]}
        onPress={() => openDatePicker("date", endAt, setEndAt, showEnd, setShowEnd)}
      >
        <Text style={styles.dateLabel}>End</Text>
        <Text style={styles.dateValue}>{formatDate(endAt)}</Text>
      </Pressable>
      {showEnd && Platform.OS !== "android" && (
        <DateTimePicker
          value={endAt}
          mode="date"
          display="spinner"
          minimumDate={startAt}
          onChange={(_, d) => {
            if (d) setEndAt(d);
            setShowEnd(false);
          }}
        />
      )}

      <Pressable
        style={({ pressed }) => [styles.btn, styles.saveBtn, pressed && { opacity: 0.8 }]}
        onPress={handleSetTimeAway}
        disabled={saving || endAt <= startAt}
      >
        {saving ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.btnText}>{timeAway ? "Update" : "Set time away"}</Text>
        )}
      </Pressable>

      {timeAway && (
        <Pressable
          style={({ pressed }) => [styles.btn, styles.clearBtn, pressed && { opacity: 0.8 }]}
          onPress={handleClear}
          disabled={saving}
        >
          <Text style={[styles.btnText, { color: theme.colors.primary }]}>Clear time away</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  current: {
    backgroundColor: theme.colors.creamAlt,
    padding: 16,
    borderRadius: 8,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: theme.colors.cream,
  },
  currentLabel: { fontSize: 12, color: "#666", marginBottom: 4 },
  currentDates: { fontSize: 16, fontWeight: "600", color: "#333" },
  badge: { fontSize: 12, color: theme.colors.primary, marginTop: 8, fontWeight: "600" },
  section: { fontSize: 16, fontWeight: "600", marginBottom: 12, color: "#333" },
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#f9f9f9",
    borderRadius: 8,
    marginBottom: 12,
  },
  dateLabel: { fontSize: 14, color: "#666" },
  dateValue: { fontSize: 16, fontWeight: "600", color: "#333" },
  btn: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtn: { backgroundColor: theme.colors.primary },
  clearBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.colors.primary },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
