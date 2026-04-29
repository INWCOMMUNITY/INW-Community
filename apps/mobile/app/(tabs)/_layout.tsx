import React, { useContext, useEffect, useState, useCallback, forwardRef } from "react";
import { useFocusEffect } from "@react-navigation/native";
import type { BottomTabBarButtonProps } from "@react-navigation/bottom-tabs";
import {
  getDefaultHeaderHeight,
  HeaderHeightContext,
  PlatformPressable,
} from "@react-navigation/elements";
import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Pressable,
  View,
  Text,
  Modal,
  Platform,
  useWindowDimensions,
  InteractionManager,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { PressableStateCallbackType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs, useRouter, usePathname } from "expo-router";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";

/** Bottom tab strings; shrink-to-fit on iOS helps ~375pt-wide phones. Layout target: min ~375 logical pt. */
const TAB_ROUTE_LABELS: Record<string, string> = {
  home: "Home",
  index: "Community",
  store: "Store",
  "support-local": "Local",
  "my-community": "Profile",
};

function BottomTabBarLabel({ routeName, color }: { routeName: string; color: string }) {
  const label = TAB_ROUTE_LABELS[routeName] ?? routeName;
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit={Platform.OS === "ios"}
      minimumFontScale={0.62}
      style={{ color, fontSize: 10, fontWeight: "500", textAlign: "center" }}
    >
      {label}
    </Text>
  );
}

const openSellerMenuRef: { current: (() => void) | null } = { current: null };
export function useOpenSellerMenu() {
  return () => openSellerMenuRef.current?.();
}

/** Set from my-community when Business Hub is shown; header QR icon calls this. */
export const openBusinessQRRef: { current: (() => void) | null } = { current: null };
import { useTheme } from "@/contexts/ThemeContext";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useProfileView } from "@/contexts/ProfileViewContext";
import { SellerHubSideMenu } from "@/components/SellerHubSideMenu";
import { BusinessHubSideMenu } from "@/components/BusinessHubSideMenu";
import { ResaleHubSideMenu } from "@/components/ResaleHubSideMenu";
import { ProfileSideMenu } from "@/components/ProfileSideMenu";
import { AppNavMenu } from "@/components/AppNavMenu";
import { CommunitySideMenu } from "@/components/CommunitySideMenu";
import { useCreatePost } from "@/contexts/CreatePostContext";

function TabBarIcon(props: {
  name: React.ComponentProps<typeof Ionicons>["name"];
  color: string;
}) {
  return <Ionicons size={24} style={{ marginBottom: -2 }} {...props} />;
}

/**
 * Fixed-width header slots so the title sits in a true center column (Expo / native stack
 * ignores or mishandles absolute-positioned title containers on some platforms).
 */
const HEADER_SIDE_SLOT_WIDTH = 96;

function HeaderSideSlot({
  side,
  children,
}: {
  side: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        width: HEADER_SIDE_SLOT_WIDTH,
        minHeight: Platform.OS === "android" ? 56 : 44,
        alignSelf: "stretch",
        justifyContent: "center",
        alignItems: side === "left" ? "flex-start" : "flex-end",
        paddingLeft: side === "left" ? 16 : 0,
        paddingRight: side === "right" ? 16 : 0,
      }}
    >
      {children}
    </View>
  );
}

function ProfileHeaderTitle() {
  const { profileView, openSwitcher, showSwitcher } = useProfileView();
  const label =
    profileView === "business_hub"
      ? "Business Hub"
      : profileView === "seller_hub"
        ? "Seller Hub"
        : profileView === "resale_hub"
          ? "Resale Hub"
          : "Profile";
  const titleTextStyle = {
    fontSize: 18,
    fontWeight: "600" as const,
    color: "#ffffff",
    textAlign: "center" as const,
    ...(Platform.OS === "android" ? { includeFontPadding: false } : {}),
  };
  if (!showSwitcher) {
    return (
      <View style={{ flex: 1, width: "100%", alignItems: "center", justifyContent: "center" }}>
        <Text style={titleTextStyle}>{label}</Text>
      </View>
    );
  }
  return (
    <View
      style={{ flex: 1, width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center" }}
    >
      <Pressable
        onPress={openSwitcher}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
      >
        {({ pressed }) => (
          <>
            <Text style={[titleTextStyle, { opacity: pressed ? 0.7 : 1 }]}>{label}</Text>
            <Ionicons name="chevron-down" size={18} color="#ffffff" style={{ opacity: pressed ? 0.7 : 1 }} />
          </>
        )}
      </Pressable>
    </View>
  );
}

type ProfileTabButtonProps = BottomTabBarButtonProps & {
  switcherShownOnceRef?: { current: boolean };
};

/**
 * Use React Navigation's PlatformPressable (not raw RN Pressable + spread).
 * Spreading tab bar props onto Pressable can forward web/link props to the native view on Android and crash.
 * Defer opening the profile switcher modal until after the tab transition on Android.
 */
const ProfileTabButton = forwardRef<React.ElementRef<typeof PlatformPressable>, ProfileTabButtonProps>(
  function ProfileTabButton(props, ref) {
    const { openSwitcher } = useProfileView();
    const { member } = useAuth();
    const { onPress, children, switcherShownOnceRef, style, ...rest } = props;

    const runAfterTabTransition = (fn: () => void) => {
      if (Platform.OS === "android") {
        InteractionManager.runAfterInteractions(() => {
          requestAnimationFrame(fn);
        });
      } else {
        fn();
      }
    };

    const styleResolvable = style as
      | StyleProp<ViewStyle>
      | ((s: PressableStateCallbackType) => StyleProp<ViewStyle>)
      | undefined;

    const mergedStyle =
      typeof styleResolvable === "function"
        ? (state: PressableStateCallbackType) => {
            const base = styleResolvable(state);
            if (Platform.OS !== "ios") return base;
            return [base, { backgroundColor: "transparent" as const }];
          }
        : Platform.OS === "ios"
          ? [styleResolvable, { backgroundColor: "transparent" as const }]
          : styleResolvable;

    return (
      <PlatformPressable
        ref={ref}
        {...rest}
        // AnimatedPressable types omit Pressable's function style; runtime supports it (same as default tab bar).
        style={mergedStyle as BottomTabBarButtonProps["style"]}
        onPress={(e) => {
          if (member && switcherShownOnceRef && !switcherShownOnceRef.current) {
            switcherShownOnceRef.current = true;
            runAfterTabTransition(() => openSwitcher());
          }
          onPress?.(e);
        }}
      >
        {children}
      </PlatformPressable>
    );
  }
);

function HubAttentionBadge() {
  const theme = useTheme();
  return (
    <View
      style={{
        minWidth: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: theme.colors.cream,
        borderWidth: 2,
        borderColor: theme.colors.primary,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 6,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: "800", color: theme.colors.primary }}>!</Text>
    </View>
  );
}

/** Flush with bottom of green header so the sheet reads as one dropdown from the bar. */
const PROFILE_SWITCHER_HEADER_GAP = 0;

function ProfileSwitcherModal({
  businessHubAttention,
  sellerHubAttention,
  resaleHubAttention,
}: {
  businessHubAttention: boolean;
  sellerHubAttention: boolean;
  resaleHubAttention: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const measuredHeaderHeight = useContext(HeaderHeightContext);
  const {
    switcherVisible,
    closeSwitcher,
    setProfileView,
    hasBusinessHub,
    hasSeller,
    hasSubscriber,
  } = useProfileView();

  /**
   * Y offset so the menu top meets the bottom edge of the green header. Prefer on-layout
   * height from HeaderHeightContext when available; otherwise use the same default as
   * @react-navigation/elements (Android toolbar is 64dp + status bar, not 56).
   */
  const fallbackHeaderBottom = getDefaultHeaderHeight(
    { width: windowWidth, height: windowHeight },
    false,
    insets.top
  );
  const menuTop =
    (measuredHeaderHeight != null && measuredHeaderHeight > 0
      ? measuredHeaderHeight
      : fallbackHeaderBottom) + PROFILE_SWITCHER_HEADER_GAP;

  return (
    <Modal
      visible={switcherVisible}
      transparent
      animationType="fade"
      onRequestClose={closeSwitcher}
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
        }}
        onPress={closeSwitcher}
      >
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: menuTop,
            left: 0,
            right: 0,
            alignItems: "center",
            paddingHorizontal: 24,
          }}
        >
          <View
            onStartShouldSetResponder={() => true}
            style={{
              minWidth: 200,
              alignSelf: "center",
              borderTopWidth: 0,
              borderBottomLeftRadius: 12,
              borderBottomRightRadius: 12,
              borderLeftWidth: 2,
              borderRightWidth: 2,
              borderBottomWidth: 2,
              borderColor: theme.colors.primary,
              overflow: "hidden",
              backgroundColor: "#ffffff",
              ...Platform.select({
                ios: {
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.12,
                  shadowRadius: 8,
                },
                android: { elevation: 6 },
                default: {},
              }),
            }}
          >
            {hasBusinessHub && (
              <Pressable
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  borderBottomWidth: 1,
                  borderBottomColor: "#eee",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
                onPress={() => {
                  setProfileView("business_hub");
                  closeSwitcher();
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: theme.colors.heading,
                    flex: 1,
                  }}
                >
                  Business Hub
                </Text>
                {businessHubAttention ? <HubAttentionBadge /> : null}
              </Pressable>
            )}
            {hasSeller && (
              <Pressable
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  borderBottomWidth: 1,
                  borderBottomColor: "#eee",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
                onPress={() => {
                  setProfileView("seller_hub");
                  closeSwitcher();
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: theme.colors.heading,
                    flex: 1,
                  }}
                >
                  Seller Hub
                </Text>
                {sellerHubAttention ? <HubAttentionBadge /> : null}
              </Pressable>
            )}
            {hasSubscriber && (
              <Pressable
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 20,
                  borderBottomWidth: 1,
                  borderBottomColor: "#eee",
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
                onPress={() => {
                  setProfileView("resale_hub");
                  closeSwitcher();
                }}
              >
                <Text
                  style={{
                    fontSize: 16,
                    fontWeight: "600",
                    color: theme.colors.heading,
                    flex: 1,
                  }}
                >
                  Resale Hub
                </Text>
                {resaleHubAttention ? <HubAttentionBadge /> : null}
              </Pressable>
            )}
            <Pressable
              style={{
                paddingVertical: 14,
                paddingHorizontal: 20,
              }}
              onPress={() => {
                setProfileView("profile");
                closeSwitcher();
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "600",
                  color: theme.colors.heading,
                }}
              >
                Profile
              </Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

type SideMenuType = "seller" | "business" | "resale" | "profile" | "app" | "community" | null;

const switcherShownOnceRef = { current: false };

function TabLayoutInner() {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { member, profileSyncError, clearProfileSyncError, refreshMember } = useAuth();
  const tabSafeInsets = useSafeAreaInsets();
  const { profileView, showSwitcher, openSwitcher, hasSeller, hasSubscriber } = useProfileView();
  const [sideMenuType, setSideMenuType] = useState<SideMenuType>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [hubAlerts, setHubAlerts] = useState({
    sellerOffersPending: false,
    buyerOffersAction: false,
    sellerFulfillmentPending: false,
  });

  useFocusEffect(
    useCallback(() => {
      apiGet<{ unreadMessages?: number }>("/api/me/sidebar-alerts")
        .then((d) => setUnreadMessages(Number(d?.unreadMessages) || 0))
        .catch(() => {});
      apiGet<{
        sellerOffersPending?: boolean;
        buyerOffersAction?: boolean;
        sellerFulfillmentPending?: boolean;
      }>("/api/me/hub-alerts")
        .then((d) =>
          setHubAlerts({
            sellerOffersPending: !!d?.sellerOffersPending,
            buyerOffersAction: !!d?.buyerOffersAction,
            sellerFulfillmentPending: !!d?.sellerFulfillmentPending,
          })
        )
        .catch(() =>
          setHubAlerts({
            sellerOffersPending: false,
            buyerOffersAction: false,
            sellerFulfillmentPending: false,
          })
        );
    }, [])
  );

  const sellerWorkPending =
    hubAlerts.sellerOffersPending || hubAlerts.sellerFulfillmentPending;
  const sellerHubAttention = hasSeller && sellerWorkPending;
  const resaleHubAttention =
    hasSubscriber && (hubAlerts.buyerOffersAction || sellerWorkPending);
  const businessHubAttention = false;

  const isProfileTab = typeof pathname === "string" && pathname.includes("my-community");
  useEffect(() => {
    if (!isProfileTab || !member || !showSwitcher || switcherShownOnceRef.current) {
      return;
    }
    let cancelled = false;
    const show = () => {
      if (cancelled || switcherShownOnceRef.current) return;
      switcherShownOnceRef.current = true;
      openSwitcher();
    };
    if (Platform.OS === "android") {
      InteractionManager.runAfterInteractions(() => {
        requestAnimationFrame(show);
      });
    } else {
      show();
    }
    return () => {
      cancelled = true;
    };
  }, [isProfileTab, member, showSwitcher, openSwitcher]);

  const profileIconName =
    profileView === "business_hub"
      ? "business"
      : profileView === "seller_hub"
        ? "briefcase"
        : profileView === "resale_hub"
          ? "cash-outline"
          : "person";

  const openSideMenu = (routeName: string) => {
    if (routeName === "my-community") {
      if (profileView === "seller_hub") setSideMenuType("seller");
      else if (profileView === "resale_hub") setSideMenuType("resale");
      else if (profileView === "business_hub") return; // Business Hub uses QR icon, no side menu
      else setSideMenuType("profile");
    } else if (routeName === "index") {
      setSideMenuType("community");
    } else {
      setSideMenuType("app");
    }
  };

  useEffect(() => {
    openSellerMenuRef.current = () => setSideMenuType("seller");
    return () => {
      openSellerMenuRef.current = null;
    };
  }, []);

  return (
    <>
    {profileSyncError ? (
      <View
        style={{
          paddingTop: tabSafeInsets.top > 0 ? 4 : 8,
          paddingHorizontal: 12,
          paddingBottom: 8,
          backgroundColor: "#fef3c7",
          borderBottomWidth: 1,
          borderBottomColor: "#fcd34d",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ flex: 1, fontSize: 13, color: "#78350f" }}>{profileSyncError}</Text>
        <Pressable
          onPress={() => refreshMember()}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingVertical: 4, paddingHorizontal: 8 })}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: theme.colors.primary }}>Retry</Text>
        </Pressable>
        <Pressable
          onPress={clearProfileSyncError}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingVertical: 4, paddingHorizontal: 8 })}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: "#78350f" }}>Dismiss</Text>
        </Pressable>
      </View>
    ) : null}
    <Tabs
      initialRouteName="home"
      screenOptions={({ route }) => ({
        tabBarActiveTintColor:
          Platform.OS === "ios" ? theme.colors.cream : theme.colors.primary,
        tabBarInactiveTintColor: "#ffffff",
        // iOS draws a rounded "bubble" behind the active tab when this is set; use transparent + cream tint instead.
        tabBarActiveBackgroundColor:
          Platform.OS === "ios" ? "transparent" : theme.colors.cream,
        tabBarInactiveBackgroundColor:
          Platform.OS === "ios" ? "transparent" : theme.colors.primary,
        ...(Platform.OS === "ios"
          ? {
              tabBarItemStyle: { backgroundColor: "transparent" },
            }
          : {}),
        tabBarStyle: {
          backgroundColor: theme.colors.primary,
          borderTopColor: theme.colors.primary,
          borderTopWidth: 2,
          minHeight: Platform.OS === "ios" ? 52 : undefined,
        },
        tabBarLabel: ({ color }) => <BottomTabBarLabel routeName={route.name} color={color} />,
        headerShown: useClientOnlyValue(false, true),
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#ffffff",
        headerTitleAlign: "center",
        headerTitleStyle: {
          fontSize: 18,
          fontWeight: "600",
          color: "#ffffff",
          textAlign: "center",
          ...(Platform.OS === "android" ? { includeFontPadding: false } : {}),
        },
        // Insets match HEADER_SIDE_SLOT_WIDTH; top/bottom fill toolbar so title centers with icon slots.
        headerTitleContainerStyle: {
          position: "absolute",
          left: HEADER_SIDE_SLOT_WIDTH,
          right: HEADER_SIDE_SLOT_WIDTH,
          top: 0,
          bottom: 0,
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "box-none",
        },
        headerLeftContainerStyle: { zIndex: 2 },
        headerRightContainerStyle: { zIndex: 2 },
        headerTitle: route.name === "my-community" ? () => <ProfileHeaderTitle /> : undefined,
        headerLeft: () => {
          let node: React.ReactNode = null;
          if (route.name === "home") {
            node = (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Notifications"
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}
                onPress={() => router.push("/notifications" as import("expo-router").Href)}
              >
                <Ionicons name="notifications" size={22} color="#FFFFFF" />
              </Pressable>
            );
          } else if (route.name === "my-community" || route.name === "index") {
            node = (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Messages"
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                style={({ pressed }) => ({
                  paddingVertical: 8,
                  opacity: pressed ? 0.75 : 1,
                })}
                onPress={() => router.push("/messages")}
              >
                <View style={{ position: "relative" }}>
                  <Ionicons name="mail" size={22} color="#ffffff" />
                  {unreadMessages > 0 && (
                    <View
                      style={{
                        position: "absolute",
                        top: -4,
                        left: -6,
                        minWidth: 14,
                        height: 14,
                        borderRadius: 7,
                        backgroundColor: "#fff",
                        justifyContent: "center",
                        alignItems: "center",
                        paddingHorizontal: 3,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: "700",
                          color: theme.colors.primary,
                        }}
                      >
                        {unreadMessages > 99 ? "99+" : String(unreadMessages)}
                      </Text>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          }
          return <HeaderSideSlot side="left">{node}</HeaderSideSlot>;
        },
        headerRight: () => {
          let node: React.ReactNode;
          if (route.name === "support-local") {
            node = (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open scanner"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.5 : 1 })}
                onPress={() => router.push("/scanner" as import("expo-router").Href)}
              >
                <Ionicons name="camera" size={24} color="#ffffff" />
              </Pressable>
            );
          } else if (route.name === "my-community" && profileView === "business_hub") {
            node = (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Business QR code"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.7 : 1 })}
                onPress={() => openBusinessQRRef.current?.()}
              >
                <Ionicons name="qr-code" size={24} color="#ffffff" />
              </Pressable>
            );
          } else {
            node = (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open menu"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                style={({ pressed }) => ({ paddingVertical: 8, opacity: pressed ? 0.5 : 1 })}
                onPress={() => openSideMenu(route.name)}
              >
                <Ionicons name="menu" size={24} color="#ffffff" />
              </Pressable>
            );
          }
          return <HeaderSideSlot side="right">{node}</HeaderSideSlot>;
        },
      })}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <TabBarIcon name="leaf" color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: "Community",
          tabBarIcon: ({ color }) => <TabBarIcon name="people" color={color} />,
        }}
      />
      <Tabs.Screen
        name="store"
        options={{
          title: "Store",
          tabBarIcon: ({ color }) => <TabBarIcon name="bag" color={color} />,
        }}
      />
      <Tabs.Screen
        name="support-local"
        options={{
          title: "Support Local",
          tabBarIcon: ({ color }) => <TabBarIcon name="hammer" color={color} />,
        }}
      />
      <Tabs.Screen
        name="my-community"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => (
            <TabBarIcon name={profileIconName} color={color} />
          ),
          tabBarButton: showSwitcher
            ? (props: any) => (
                <ProfileTabButton {...props} switcherShownOnceRef={switcherShownOnceRef} />
              )
            : undefined,
        }}
      />
    </Tabs>

    <SellerHubSideMenu
      visible={sideMenuType === "seller"}
      onClose={() => setSideMenuType(null)}
    />
    <BusinessHubSideMenu
      visible={sideMenuType === "business"}
      onClose={() => setSideMenuType(null)}
    />
    <ResaleHubSideMenu
      visible={sideMenuType === "resale"}
      onClose={() => setSideMenuType(null)}
    />
    <ProfileSideMenu
      visible={sideMenuType === "profile"}
      onClose={() => setSideMenuType(null)}
      hasSubscriber={hasSubscriber}
    />
    <AppNavMenu
      visible={sideMenuType === "app"}
      onClose={() => setSideMenuType(null)}
      hasSeller={hasSeller}
      hasSubscriber={hasSubscriber}
    />
    <CommunitySideMenuWithContext
      visible={sideMenuType === "community"}
      onClose={() => setSideMenuType(null)}
    />

    <ProfileSwitcherModal
      businessHubAttention={businessHubAttention}
      sellerHubAttention={sellerHubAttention}
      resaleHubAttention={resaleHubAttention}
    />

    </>
  );
}

function CommunitySideMenuWithContext({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const createPost = useCreatePost();
  return (
    <CommunitySideMenu
      visible={visible}
      onClose={onClose}
      onOpenCreatePost={createPost?.openCreatePost}
    />
  );
}

export default function TabLayout() {
  return <TabLayoutInner />;
}
