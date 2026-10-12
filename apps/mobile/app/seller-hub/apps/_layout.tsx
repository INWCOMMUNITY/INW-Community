import { Platform, Pressable } from "react-native";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export default function SyncAirportLayout() {
  return (
    <Stack
      screenOptions={({ navigation }) => ({
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#fff",
        headerBackTitle: "Back",
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: "#fff" },
        headerLeft: () => (
          <Pressable
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                const parent = navigation.getParent();
                if (parent?.canGoBack()) parent.goBack();
              }
            }}
            hitSlop={12}
            style={{
              paddingHorizontal: Platform.OS === "ios" ? 8 : 12,
              paddingVertical: 8,
            }}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
        ),
      })}
    >
      <Stack.Screen name="index" options={{ title: "Sync Airport" }} />
      <Stack.Screen name="etsy" options={{ title: "Etsy" }} />
    </Stack>
  );
}
