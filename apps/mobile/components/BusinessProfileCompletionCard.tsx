import { useState, useEffect, useCallback } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

interface BusinessProfileInfo {
  id: string;
  name: string;
  shortDescription: string | null;
  fullDescription: string | null;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  hoursOfOperation: Record<string, string> | null;
  photos: string[];
}

interface CompletionItem {
  key: string;
  label: string;
  complete: boolean;
  weight: number;
}

function calculateCompletion(business: BusinessProfileInfo): {
  percentage: number;
  items: CompletionItem[];
} {
  const items: CompletionItem[] = [
    { key: "name", label: "Business name", complete: !!business.name?.trim(), weight: 15 },
    { key: "shortDescription", label: "Brief description", complete: !!business.shortDescription?.trim(), weight: 15 },
    { key: "fullDescription", label: "Full description", complete: !!business.fullDescription?.trim(), weight: 10 },
    { key: "logoUrl", label: "Logo", complete: !!business.logoUrl?.trim(), weight: 15 },
    { key: "address", label: "Address", complete: !!business.address?.trim(), weight: 10 },
    { key: "phone", label: "Phone number", complete: !!business.phone?.trim(), weight: 5 },
    { key: "email", label: "Email", complete: !!business.email?.trim(), weight: 5 },
    { key: "website", label: "Website", complete: !!business.website?.trim(), weight: 5 },
    {
      key: "hoursOfOperation",
      label: "Hours of operation",
      complete:
        !!business.hoursOfOperation &&
        typeof business.hoursOfOperation === "object" &&
        Object.keys(business.hoursOfOperation).length > 0,
      weight: 10,
    },
    { key: "photos", label: "Gallery photos", complete: (business.photos?.length ?? 0) >= 1, weight: 10 },
  ];

  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  const completedWeight = items.reduce(
    (sum, item) => sum + (item.complete ? item.weight : 0),
    0
  );
  const percentage = Math.round((completedWeight / totalWeight) * 100);

  return { percentage, items };
}

const STORAGE_KEY = "nwc-profile-completion-dismissed";

export function BusinessProfileCompletionCard({
  businessIds,
  onOpenBusinessForm,
}: {
  businessIds: string[];
  onOpenBusinessForm: () => void;
}) {
  const [dismissed, setDismissed] = useState(true);
  const [businesses, setBusinesses] = useState<BusinessProfileInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBusinesses = useCallback(async () => {
    if (businessIds.length === 0) {
      setLoading(false);
      return;
    }
    try {
      const results = await Promise.all(
        businessIds.map((id) =>
          apiGet<BusinessProfileInfo>(`/api/businesses/${id}`).catch(() => null)
        )
      );
      setBusinesses(results.filter(Boolean) as BusinessProfileInfo[]);
    } catch {
      setBusinesses([]);
    } finally {
      setLoading(false);
    }
  }, [businessIds]);

  useEffect(() => {
    fetchBusinesses();
  }, [fetchBusinesses]);

  useEffect(() => {
    if (loading || businesses.length === 0) return;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((val) => {
        const dismissedIds = JSON.parse(val ?? "[]");
        const allDismissed = businesses.every((b) => dismissedIds.includes(b.id));
        setDismissed(allDismissed);
      })
      .catch(() => setDismissed(false));
  }, [businesses, loading]);

  if (loading || dismissed || businesses.length === 0) return null;

  const handleDismiss = async () => {
    try {
      const val = await AsyncStorage.getItem(STORAGE_KEY);
      const dismissedIds = JSON.parse(val ?? "[]");
      const newDismissed = [...new Set([...dismissedIds, ...businesses.map((b) => b.id)])];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newDismissed));
    } catch {
      // ignore storage errors
    }
    setDismissed(true);
  };

  const firstIncomplete = businesses.find((b) => {
    const { percentage } = calculateCompletion(b);
    return percentage < 100;
  });

  if (!firstIncomplete) return null;

  const { percentage, items } = calculateCompletion(firstIncomplete);
  const missingItems = items.filter((item) => !item.complete);

  if (percentage === 100) return null;

  return (
    <View style={styles.container}>
      <Pressable
        style={({ pressed }) => [styles.dismissButton, pressed && { opacity: 0.7 }]}
        onPress={handleDismiss}
      >
        <Ionicons name="close" size={18} color="#6b7280" />
      </Pressable>

      <View style={styles.content}>
        <View style={styles.percentageCircle}>
          <Text style={styles.percentageText}>{percentage}%</Text>
        </View>
        <View style={styles.textContent}>
          <Text style={styles.title}>Complete your business profile</Text>
          <Text style={styles.subtitle}>
            A complete profile helps customers find and trust your business.
          </Text>
          {missingItems.length > 0 && (
            <View style={styles.missingSection}>
              <Text style={styles.missingLabel}>Missing:</Text>
              <View style={styles.missingTags}>
                {missingItems.slice(0, 3).map((item) => (
                  <View key={item.key} style={styles.missingTag}>
                    <Text style={styles.missingTagText}>{item.label}</Text>
                  </View>
                ))}
                {missingItems.length > 3 && (
                  <Text style={styles.moreText}>+{missingItems.length - 3} more</Text>
                )}
              </View>
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.85 }]}
            onPress={onOpenBusinessForm}
          >
            <Ionicons name="create-outline" size={16} color="#fff" />
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.progressBarContainer}>
        <View style={[styles.progressBar, { width: `${percentage}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.creamAlt,
    padding: 16,
    position: "relative",
  },
  dismissButton: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  content: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingRight: 24,
  },
  percentageCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  percentageText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  textContent: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 10,
    lineHeight: 18,
  },
  missingSection: {
    marginBottom: 12,
  },
  missingLabel: {
    fontSize: 11,
    color: "#6b7280",
    marginBottom: 6,
  },
  missingTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  missingTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  missingTagText: {
    fontSize: 11,
    color: theme.colors.primary,
  },
  moreText: {
    fontSize: 11,
    color: "#6b7280",
    alignSelf: "center",
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  editButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 13,
  },
  progressBarContainer: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#e5e7eb",
    marginTop: 14,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
  },
});
