import { Stack } from "expo-router";
import { Platform, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

export default function SellerStoreLayout() {
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
                if (parent?.canGoBack()) {
                  parent.goBack();
                }
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
      <Stack.Screen name="index" options={{ title: "Seller Page" }} />
      <Stack.Screen name="manage" options={{ title: "Manage Store" }} />
      <Stack.Screen name="edit" options={{ title: "Edit Seller Profile" }} />
      <Stack.Screen name="new" options={{ title: "List an Item" }} />
      <Stack.Screen name="sold" options={{ title: "Sold Items" }} />
      <Stack.Screen name="items/index" options={{ title: "My Items" }} />
      <Stack.Screen name="drafts/index" options={{ title: "Drafts" }} />
      <Stack.Screen name="payouts/index" options={{ title: "Payouts" }} />
      <Stack.Screen name="cancellations/index" options={{ title: "Cancellations" }} />
      <Stack.Screen name="returns/index" options={{ title: "Refund Requests" }} />
      <Stack.Screen name="actions/index" options={{ title: "Actions" }} />
    </Stack>
  );
}
