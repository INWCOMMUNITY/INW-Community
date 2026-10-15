import { Stack } from "expo-router";
import { theme } from "@/lib/theme";

export default function EtsySectionLayout() {
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
      <Stack.Screen name="index" options={{ title: "Etsy" }} />
      <Stack.Screen name="settings" options={{ title: "Etsy Settings" }} />
      <Stack.Screen name="sync" options={{ title: "List on Etsy" }} />
      <Stack.Screen name="import" options={{ title: "Import from Etsy" }} />
    </Stack>
  );
}
