import { Stack } from "expo-router";
import { useTheme } from "@/contexts/ThemeContext";

export default function CalendarsLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#ffffff",
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: "Calendars",
          headerBackVisible: true,
        }}
      />
      <Stack.Screen
        name="[type]"
        options={{
          title: "Calendar",
          headerBackVisible: true,
        }}
      />
      <Stack.Screen
        name="web"
        options={{
          title: "Post Event",
          headerBackVisible: true,
        }}
      />
    </Stack>
  );
}
