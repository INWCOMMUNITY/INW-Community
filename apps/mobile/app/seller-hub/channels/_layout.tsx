import { Stack, useRouter } from "expo-router";
import { Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export default function ChannelsLayout() {
  const router = useRouter();

  const goBack = (navigation: { canGoBack: () => boolean; goBack: () => void; getParent: () => unknown }) => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    const parent = navigation.getParent() as { canGoBack?: () => boolean; goBack?: () => void } | undefined;
    if (parent?.canGoBack?.()) {
      parent.goBack?.();
      return;
    }
    router.replace("/(tabs)/my-community" as never);
  };

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
            onPress={() => goBack(navigation)}
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
      <Stack.Screen name="index" options={{ title: "Sync Stores" }} />
      <Stack.Screen name="import" options={{ title: "Import Listings" }} />
    </Stack>
  );
}
