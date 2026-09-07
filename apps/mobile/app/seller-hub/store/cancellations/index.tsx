import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";

/** Cash-order re-list is retired; storefront checkout is card-only. */
export default function CancellationsRedirectScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/seller-hub/orders");
  }, [router]);
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
});
