import { useEffect } from "react";
import { ActivityIndicator, View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useProfileView } from "@/contexts/ProfileViewContext";
import { theme } from "@/lib/theme";

/**
 * Deep link /seller-hub → My Community with Seller Hub view selected.
 */
export default function SellerHubIndex() {
  const router = useRouter();
  const { setProfileView } = useProfileView();

  useEffect(() => {
    setProfileView("seller_hub");
    router.replace("/(tabs)/my-community" as never);
  }, [router, setProfileView]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
});
