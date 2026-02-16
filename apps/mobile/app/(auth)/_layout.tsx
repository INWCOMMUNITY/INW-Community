import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="signin" />
      <Stack.Screen name="signup-business" />
      <Stack.Screen name="signup-seller" />
      <Stack.Screen name="signup-resident" />
    </Stack>
  );
}
