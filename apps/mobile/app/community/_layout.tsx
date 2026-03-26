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
      <Stack.Screen name="posts-photos" options={{ title: "Posted Photos" }} />
      <Stack.Screen name="groups" options={{ title: "Community Groups" }} />
      <Stack.Screen name="group/[slug]" options={{ title: "Group" }} />
      <Stack.Screen name="my-orders/index" options={{ title: "My Orders" }} />
      <Stack.Screen name="my-orders/[id]" options={{ title: "Order Details" }} />
      <Stack.Screen name="my-friends" options={{ title: "My Friends" }} />
      <Stack.Screen name="friend-requests" options={{ title: "Friend Requests" }} />
      <Stack.Screen name="blogs" options={{ title: "Blogs" }} />
    </Stack>
  );
}
