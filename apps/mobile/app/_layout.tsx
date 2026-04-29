import "react-native-gesture-handler";
import "@/lib/font-accessibility";
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
import { View, Text, StyleSheet, Pressable, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import 'react-native-reanimated';

import { StripeProvider } from '@stripe/stripe-react-native';
import { useColorScheme } from '@/components/useColorScheme';
import { setToken } from '@/lib/api';
import { captureReferralCodeFromUrl } from '@/lib/referral-code';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  ProfileViewProvider,
  type ProfileView,
} from '@/contexts/ProfileViewContext';
import { useAuth } from '@/contexts/AuthContext';
import { trackAppOpen } from '@/lib/api';
import * as WebBrowser from 'expo-web-browser';
import { PushNotificationHandler } from '@/components/PushNotificationHandler';
import { EventInvitePopupHost } from '@/components/EventInvitePopupHost';
import { theme } from '@/lib/theme';
import { CreatePostProvider } from '@/contexts/CreatePostContext';
import { CreatePostModalHost } from '@/components/CreatePostModalHost';
import { GuestRouteGuard } from '@/components/GuestRouteGuard';
import { EventInvitePopupSuppressionProvider } from '@/contexts/EventInvitePopupSuppressionContext';

/** True if the string looks like HTML (never render raw in UI). */
function looksLikeHtml(s: string): boolean {
  const t = s?.trim() ?? '';
  return t.startsWith('<!') || t.startsWith('<html');
}

/** Custom ErrorBoundary so unhandled errors show a friendly screen instead of RCTFatal. */
export function ErrorBoundary({
  error,
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  const raw = error?.message ?? 'Something went wrong.';
  const message = looksLikeHtml(raw)
    ? 'The server returned an unexpected response. Please check your connection or try again later.'
    : raw;

  return (
    <View style={errorBoundaryStyles.container}>
      <Text style={errorBoundaryStyles.title}>Something went wrong</Text>
      <Text style={errorBoundaryStyles.message} numberOfLines={5}>
        {message}
      </Text>
      <Pressable
        style={({ pressed }) => [errorBoundaryStyles.button, pressed && { opacity: 0.8 }]}
        onPress={retry}
      >
        <Text style={errorBoundaryStyles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const errorBoundaryStyles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.heading,
    marginBottom: 12,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

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

  useEffect(() => {
    if (loaded) {
      trackAppOpen();
    }
  }, [loaded]);

  useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
  }, []);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

/** When app is opened via inwcommunity://auth?token=... (e.g. after browser login), store token and go home. */
function AuthDeepLinkHandler() {
  const { refreshMember } = useAuth();
  const router = useRouter();
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url?.startsWith('inwcommunity://auth')) return;
      const match = url.match(/[?&]token=([^&]+)/);
      const token = match ? decodeURIComponent(match[1]) : null;
      if (!token) return;
      await setToken(token);
      await refreshMember?.().catch(() => {});
      router.replace('/(tabs)/home' as never);
    };
    void Linking.getInitialURL()
      .then(async (url) => {
        try {
          await handleUrl(url);
        } catch (e) {
          if (__DEV__) console.warn('[AuthDeepLinkHandler]', e);
        }
      })
      .catch((e) => {
        if (__DEV__) console.warn('[AuthDeepLinkHandler] getInitialURL', e);
      });
    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleUrl(url).catch((e) => {
        if (__DEV__) console.warn('[AuthDeepLinkHandler] url event', e);
      });
    });
    return () => sub.remove();
  }, [refreshMember, router]);
  return null;
}

/** Store ?ref= from universal / signup links so the next in-app signup can attribute referrals. */
function ReferralDeepLinkHandler() {
  useEffect(() => {
    const run = (url: string | null) => {
      if (url) void captureReferralCodeFromUrl(url);
    };
    void Linking.getInitialURL().then(run);
    const sub = Linking.addEventListener('url', ({ url }) => run(url));
    return () => sub.remove();
  }, []);
  return null;
}

function ProfileViewLayout({ children }: { children: React.ReactNode }) {
  const { member, subscriptionPlan } = useAuth();
  const hasSponsor = member?.subscriptions?.some((s) => s.plan === "sponsor") ?? false;
  const hasSeller = member?.subscriptions?.some((s) => s.plan === "seller") ?? false;
  const hasResaleHubSwitcher = member?.hasResaleHubAccess ?? false;
  const hasBusinessHubFromApi = member?.hasBusinessHubAccess ?? false;
  const defaultView: ProfileView =
    subscriptionPlan === "seller"
      ? "seller_hub"
      : subscriptionPlan === "sponsor"
        ? "business_hub"
        : hasBusinessHubFromApi
          ? "business_hub"
          : hasResaleHubSwitcher
            ? "resale_hub"
            : "profile";
  return (
    <ProfileViewProvider
      hasSponsor={hasSponsor}
      hasSeller={hasSeller}
      hasSubscriber={hasResaleHubSwitcher}
      hasBusinessHubFromApi={hasBusinessHubFromApi}
      defaultView={defaultView}
    >
      {children}
    </ProfileViewProvider>
  );
}

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';
const hasStripeKey = !!stripePublishableKey && !stripePublishableKey.includes('placeholder');
const stripeMerchantId = process.env.EXPO_PUBLIC_STRIPE_MERCHANT_IDENTIFIER ?? 'merchant.com.northwestcommunity';

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  const content = (
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
        <Stack.Screen name="seller/[slug]" />
        <Stack.Screen name="coupons/index" />
        <Stack.Screen name="rewards/index" />
        <Stack.Screen name="redeemed-rewards" options={{ headerShown: false }} />
        <Stack.Screen name="business-hub-offered-coupons" options={{ headerShown: false }} />
        <Stack.Screen name="business-hub-offered-rewards" options={{ headerShown: false }} />
        <Stack.Screen name="business-hub-manage" options={{ headerShown: false }} />
        <Stack.Screen name="business-hub-my-posts" options={{ headerShown: false }} />
        <Stack.Screen name="business-hub-my-events" options={{ headerShown: false }} />
        <Stack.Screen name="support-request" options={{ headerShown: false }} />
        <Stack.Screen name="profile-edit" />
        <Stack.Screen name="profile-notification-settings" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="share-inw-community" options={{ headerShown: false }} />
        <Stack.Screen name="policies" />
        <Stack.Screen name="profile-businesses" />
        <Stack.Screen name="profile-events" />
        <Stack.Screen name="profile-event-edit/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="profile-coupons" />
        <Stack.Screen name="profile-wishlist" />
        <Stack.Screen name="sponsor-business" options={{ headerShown: false }} />
        <Stack.Screen name="seller-hub" options={{ headerShown: false }} />
        <Stack.Screen name="resale-hub" options={{ headerShown: false }} />
        <Stack.Screen name="messages" options={{ headerShown: false }} />
        <Stack.Screen name="badges" />
        <Stack.Screen name="my-badges" />
        <Stack.Screen name="my-sellers" />
        <Stack.Screen name="scanner" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="saved-posts" />
        <Stack.Screen name="blocked-members" options={{ headerShown: false }} />
        <Stack.Screen name="subscribe" />
        <Stack.Screen name="manage-subscription" options={{ headerShown: false }} />
        <Stack.Screen name="community" options={{ headerShown: false }} />
        <Stack.Screen name="post" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'containedModal' }} />
      </Stack>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider>
      <AuthProvider>
      <GuestRouteGuard>
      <EventInvitePopupSuppressionProvider>
      <AuthDeepLinkHandler />
      <ReferralDeepLinkHandler />
      <PushNotificationHandler />
      <EventInvitePopupHost />
      <CreatePostProvider>
      <ProfileViewLayout>
      <NavThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {hasStripeKey ? (
        <StripeProvider
          publishableKey={stripePublishableKey}
          urlScheme="mobile"
          merchantIdentifier={stripeMerchantId}
        >
          {content}
        </StripeProvider>
      ) : (
        content
      )}
      <CreatePostModalHost />
    </NavThemeProvider>
    </ProfileViewLayout>
    </CreatePostProvider>
    </EventInvitePopupSuppressionProvider>
    </GuestRouteGuard>
    </AuthProvider>
    </ThemeProvider>
    </GestureHandlerRootView>
  );
}
