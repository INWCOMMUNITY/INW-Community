import { useEffect } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";

export default function SellerHubPickupsScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/seller-hub/orders?tab=pickups");
  }, [router]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
});
