import FontAwesome from '@expo/vector-icons/FontAwesome';
import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import {
  Fahkwang_400Regular,
  Fahkwang_700Bold,
} from '@expo-google-fonts/fahkwang';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  ProfileViewProvider,
  type ProfileView,
} from '@/contexts/ProfileViewContext';
import { useAuth } from '@/contexts/AuthContext';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: 'index',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    Fahkwang_400Regular,
    Fahkwang_700Bold,
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function ProfileViewLayout({ children }: { children: React.ReactNode }) {
  const { member, subscriptionPlan } = useAuth();
  const hasSponsor = member?.subscriptions?.some((s) => s.plan === "sponsor") ?? false;
  const hasSeller = member?.subscriptions?.some((s) => s.plan === "seller") ?? false;
  const hasSubscriber = member?.isSubscriber ?? false;
  const defaultView: ProfileView =
    subscriptionPlan === "sponsor"
      ? "business_hub"
      : subscriptionPlan === "seller"
        ? "seller_hub"
        : hasSubscriber
          ? "resale_hub"
          : "profile";
  return (
    <ProfileViewProvider
      hasSponsor={hasSponsor}
      hasSeller={hasSeller}
      hasSubscriber={hasSubscriber}
      defaultView={defaultView}
    >
      {children}
    </ProfileViewProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider>
      <AuthProvider>
      <ProfileViewLayout>
      <NavThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="calendars" />
        <Stack.Screen name="web" />
        <Stack.Screen name="product/[slug]" />
        <Stack.Screen name="event/[slug]" />
        <Stack.Screen name="cart" />
        <Stack.Screen name="business/[slug]" />
        <Stack.Screen name="coupons" />
        <Stack.Screen name="rewards" />
        <Stack.Screen name="profile-edit" />
        <Stack.Screen name="policies" />
        <Stack.Screen name="profile-businesses" />
        <Stack.Screen name="profile-events" />
        <Stack.Screen name="profile-coupons" />
        <Stack.Screen name="profile-wishlist" />
        <Stack.Screen name="sponsor-business" options={{ headerShown: false }} />
        <Stack.Screen name="seller-hub" options={{ headerShown: false }} />
        <Stack.Screen name="resale-hub" options={{ headerShown: false }} />
        <Stack.Screen name="messages" options={{ headerShown: false }} />
        <Stack.Screen name="badges" />
        <Stack.Screen name="my-badges" />
        <Stack.Screen name="community" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>
    </NavThemeProvider>
    </ProfileViewLayout>
    </AuthProvider>
    </ThemeProvider>
    </GestureHandlerRootView>
  );
}
