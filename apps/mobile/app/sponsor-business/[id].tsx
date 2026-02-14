import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { Stack } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiDelete } from "@/lib/api";
import { BusinessForm, type BusinessFormData } from "@/components/BusinessForm";

export default function SponsorBusinessEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [business, setBusiness] = useState<BusinessFormData | null | "loading" | "error">("loading");

  useEffect(() => {
    if (!id) {
      setBusiness("error");
      return;
    }
    apiGet<BusinessFormData | { error: string }>(`/api/businesses/${id}`)
      .then((data) => {
        if ("error" in data) {
          setBusiness("error");
        } else {
          setBusiness({
            ...data,
            categories: Array.isArray(data.categories) ? data.categories : [],
            photos: Array.isArray(data.photos) ? data.photos : [],
          });
        }
      })
      .catch(() => setBusiness("error"));
  }, [id]);

  const handleDelete = () => {
    if (!id) return;
    Alert.alert(
      "Delete business",
      "Are you sure you want to delete this business? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await apiDelete(`/api/businesses/${id}`);
              router.replace("/sponsor-business");
            } catch {
              Alert.alert("Error", "Failed to delete business.");
            }
          },
        },
      ]
    );
  };

  if (business === "loading" || business === "error") {
    return (
      <>
        <Stack.Screen options={{ title: "Edit business", headerBackTitle: "Back" }} />
        <View style={styles.center}>
          {business === "loading" ? (
            <ActivityIndicator size="large" color={theme.colors.primary} />
          ) : (
            <Text style={styles.errorText}>Failed to load business.</Text>
          )}
        </View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "Edit business",
          headerBackTitle: "Back",
        }}
      />
      <BusinessForm
        existing={business}
        onSuccess={() => router.replace("/sponsor-business")}
        onDelete={handleDelete}
      />
    </>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  errorText: {
    fontSize: 16,
    color: "#c00",
  },
});
