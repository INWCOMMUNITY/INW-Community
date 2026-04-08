import { Stack, useRouter } from "expo-router";
import { Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export default function CommunityLayout() {
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
      <Stack.Screen name="tags" options={{ title: "Tags" }} />
      <Stack.Screen
        name="posts-photos"
        options={{
          title: "Posted Photos / Posts",
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={({ pressed }) => [{ padding: 4, opacity: pressed ? 0.85 : 1 }]}
              {...(Platform.OS === "android"
                ? { android_ripple: { color: "rgba(255,255,255,0.2)", borderless: true } }
                : {})}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen name="groups" options={{ title: "Community Groups" }} />
      <Stack.Screen name="group-admin" options={{ title: "Group admin" }} />
      <Stack.Screen
        name="group/[slug]"
        options={{
          title: "Group",
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={({ pressed }) => [{ padding: 4, opacity: pressed ? 0.85 : 1 }]}
              {...(Platform.OS === "android"
                ? { android_ripple: { color: "rgba(255,255,255,0.2)", borderless: true } }
                : {})}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </Pressable>
          ),
        }}
      />
      <Stack.Screen name="my-orders/index" options={{ title: "My Orders" }} />
      <Stack.Screen name="my-orders/[id]" options={{ title: "Order Details" }} />
      <Stack.Screen name="my-friends" options={{ title: "My Friends" }} />
      <Stack.Screen name="friend-requests" options={{ title: "Friend Requests" }} />
      <Stack.Screen name="invites" options={{ title: "Local Event Invites" }} />
      <Stack.Screen name="blogs" options={{ title: "Blogs" }} />
    </Stack>
  );
}
