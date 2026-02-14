import { Stack } from "expo-router";

export default function SellerStoreLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#fff" },
      }}
    >
      <Stack.Screen
        name="items"
        options={{ title: "My Items" }}
      />
      <Stack.Screen
        name="new"
        options={{ title: "List an Item" }}
      />
      <Stack.Screen
        name="drafts"
        options={{ title: "Drafts" }}
      />
    </Stack>
  );
}
