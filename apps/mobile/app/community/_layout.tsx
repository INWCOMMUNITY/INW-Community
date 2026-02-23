import { Stack } from "expo-router";
import { theme } from "@/lib/theme";

export default function CommunityLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#ffffff",
        headerTitleStyle: { fontWeight: "600" },
      }}
    >
      <Stack.Screen name="tags" options={{ title: "Tags" }} />
    </Stack>
  );
}
