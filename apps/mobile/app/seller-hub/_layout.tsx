import { Platform } from "react-native";
import { Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { theme } from "@/lib/theme";

function useHeaderTitle() {
  const segments = useSegments();
  const path = segments.join("/");
  const last = segments[segments.length - 1];
  const prev = segments[segments.length - 2];
  if (path.includes("store/new") || (last === "new" && prev === "store")) return "List an Item";
  if (path.includes("store/drafts") || (last === "drafts" && prev === "store")) return "Drafts";
  if (path.includes("store/items") || (last === "items" && prev === "store")) return "My Items";
  if (path.includes("ship") || last === "ship") return "Ship Items";
  return "Seller Hub";
}

export default function SellerHubLayout() {
  const headerTitle = useHeaderTitle();
  return (
    <>
      <StatusBar style="light" backgroundColor={Platform.OS === "android" ? theme.colors.primary : undefined} />
      <Stack
        screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#fff",
        headerBackTitle: "Back",
        headerTitle: headerTitle,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#fff" },
        }}
      />
    </>
  );
}
