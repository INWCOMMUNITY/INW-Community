import { useEffect, useState } from "react";
import { StyleSheet, View, ActivityIndicator, Text, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import {
  PostEventForm,
  type PostEventInitialData,
} from "@/components/PostEventForm";
import type { CalendarType } from "@/lib/calendars";

type ApiEvent = {
  title: string;
  date: string;
  time: string | null;
  endTime: string | null;
  location: string | null;
  city: string | null;
  description: string | null;
  calendarType: string;
  photos: string[];
  businessId: string | null;
};

function toInitial(data: ApiEvent): PostEventInitialData {
  return {
    title: data.title,
    date: data.date,
    time: data.time,
    endTime: data.endTime,
    location: data.location,
    city: data.city,
    description: data.description,
    calendarType: data.calendarType as CalendarType,
    photos: Array.isArray(data.photos) ? data.photos : [],
    businessId: data.businessId,
  };
}

export default function ProfileEventEditScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [initial, setInitial] = useState<PostEventInitialData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id || typeof id !== "string") {
        setError("Missing event.");
        setLoading(false);
        return;
      }
      try {
        const data = await apiGet<ApiEvent>(`/api/events/${id}`);
        if (!cancelled) {
          setInitial(toInitial(data));
          setError(null);
        }
      } catch {
        if (!cancelled) {
          setError("Could not load this event. It may have been removed.");
          setInitial(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <View style={styles.flex}>
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Edit event</Text>
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.centerPad}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => router.back()}>
            <Text style={styles.retryBtnText}>Go back</Text>
          </Pressable>
        </View>
      ) : initial && id ? (
        <PostEventForm
          key={id}
          editEventId={id}
          initialEvent={initial}
          onSuccess={() => router.back()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
    paddingTop: 48,
    backgroundColor: theme.colors.primary,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  centerPad: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  errorText: { fontSize: 16, color: theme.colors.text, marginBottom: 16 },
  retryBtn: {
    alignSelf: "flex-start",
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  retryBtnText: { color: theme.colors.buttonText, fontWeight: "600" },
});
