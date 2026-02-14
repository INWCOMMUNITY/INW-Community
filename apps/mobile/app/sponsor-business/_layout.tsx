import { Stack } from "expo-router";
import { theme } from "@/lib/theme";

export default function SponsorBusinessLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#fff",
      }}
    />
  );
}
