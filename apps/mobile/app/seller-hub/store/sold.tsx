import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";

export default function SoldItemsRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/seller-hub/store/items?tab=sold");
  }, [router]);

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" }}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}
