import { Platform } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { theme } from "@/lib/theme";

export default function ResaleHubLayout() {
  return (
    <>
      <StatusBar style="light" backgroundColor={Platform.OS === "android" ? theme.colors.primary : undefined} />
      <Stack
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: theme.colors.primary },
          headerTintColor: "#fff",
          headerBackTitle: "Back",
          headerShadowVisible: false,
          contentStyle: { backgroundColor: "#fff" },
        }}
      >
        <Stack.Screen name="list" options={{ title: "List an Item" }} />
        <Stack.Screen name="listings" options={{ title: "My Listings" }} />
        <Stack.Screen name="ship" options={{ title: "Ship an Item" }} />
        <Stack.Screen name="deliveries" options={{ title: "My Deliveries" }} />
        <Stack.Screen name="pickups" options={{ title: "My Pickups" }} />
        <Stack.Screen name="offers" options={{ title: "New Offers" }} />
        <Stack.Screen name="cancellations" options={{ title: "Cancellations" }} />
      </Stack>
    </>
  );
}
