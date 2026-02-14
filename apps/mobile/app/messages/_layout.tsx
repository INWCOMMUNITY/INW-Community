import { Stack } from "expo-router";

export default function MessagesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="new" />
      <Stack.Screen name="new-group" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="resale/[id]" />
      <Stack.Screen name="group/[id]" />
    </Stack>
  );
}
