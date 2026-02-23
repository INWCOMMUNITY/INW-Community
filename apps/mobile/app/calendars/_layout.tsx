import { Stack, useRouter } from "expo-router";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/contexts/ThemeContext";

export default function CalendarsLayout() {
  const theme = useTheme();
  const router = useRouter();

  const backButton = () => (
    <Pressable onPress={() => router.back()} style={{ padding: 4 }}>
      <Ionicons name="arrow-back" size={24} color="#fff" />
    </Pressable>
  );

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
          headerLeft: backButton,
        }}
      />
      <Stack.Screen
        name="[type]"
        options={{
          title: "Calendar",
          headerLeft: backButton,
        }}
      />
      <Stack.Screen
        name="web"
        options={{
          title: "Post Event",
          headerLeft: backButton,
        }}
      />
    </Stack>
  );
}
