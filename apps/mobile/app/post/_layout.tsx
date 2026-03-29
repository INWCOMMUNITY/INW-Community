import { Stack, useRouter } from "expo-router";
import { Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export default function PostLayout() {
  const router = useRouter();
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#ffffff",
        headerTitleStyle: { fontWeight: "600" },
        headerBackTitle: "Back",
      }}
    >
      <Stack.Screen
        name="[id]"
        options={{
          title: "Post",
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              style={{ padding: 4 }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
