import { Stack } from "expo-router";
import { theme } from "@/lib/theme";

export default function ShopifySectionLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#fff",
        headerBackTitle: "Back",
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#fff" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Shopify" }} />
      <Stack.Screen name="settings" options={{ title: "Shopify Settings" }} />
      <Stack.Screen name="sync" options={{ title: "List on Shopify" }} />
      <Stack.Screen name="import" options={{ title: "Import from Shopify" }} />
    </Stack>
  );
}
