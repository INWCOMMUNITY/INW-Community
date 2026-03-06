import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";

/**
 * Redirect to Seller Hub Deliveries screen.
 */
export default function ResaleHubDeliveriesRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/seller-hub/deliveries" as never);
  }, [router]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
