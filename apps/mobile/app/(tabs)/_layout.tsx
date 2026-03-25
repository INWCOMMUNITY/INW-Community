import { useEffect, useState, useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View, Text, Modal } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Tabs, useRouter, usePathname } from "expo-router";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";

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
  if (!showSwitcher) {
    return <Text style={{ fontSize: 18, fontWeight: "600", color: "#ffffff" }}>{label}</Text>;
  }
  return (
    <Pressable onPress={openSwitcher} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      {({ pressed }) => (
        <>
          <Text style={{ fontSize: 18, fontWeight: "600", color: "#ffffff", opacity: pressed ? 0.7 : 1 }}>
            {label}
          </Text>
          <Ionicons name="chevron-down" size={18} color="#ffffff" style={{ opacity: pressed ? 0.7 : 1 }} />
        </>
      )}
    </Pressable>
  );
}

function ProfileTabButton(props: {
  children?: React.ReactNode;
  onPress?: () => void;
  switcherShownOnceRef?: { current: boolean };
  [key: string]: unknown;
}) {
  const { openSwitcher } = useProfileView();
  const { onPress, children, switcherShownOnceRef, ...rest } = props;
  return (
    <Pressable
      {...rest}
      onPress={() => {
        if (switcherShownOnceRef && !switcherShownOnceRef.current) {
          switcherShownOnceRef.current = true;
          openSwitcher();
        }
        onPress?.();
      }}
    >
      {children}
    </Pressable>
  );
}

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
  const {
    switcherVisible,
    closeSwitcher,
    setProfileView,
    hasSponsor,
    hasSeller,
    hasSubscriber,
  } = useProfileView();

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
          justifyContent: "flex-start",
          paddingTop: 100,
          paddingHorizontal: 24,
          alignItems: "center",
        }}
        onPress={closeSwitcher}
      >
        <View
          style={{
            minWidth: 200,
            borderRadius: 8,
            borderWidth: 2,
            borderColor: theme.colors.primary,
            overflow: "hidden",
            backgroundColor: "#ffffff",
          }}
        >
          {hasSponsor && (
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
  const { profileSyncError, clearProfileSyncError, refreshMember } = useAuth();
  const tabSafeInsets = useSafeAreaInsets();
  const { profileView, showSwitcher, openSwitcher, hasSponsor, hasSeller, hasSubscriber } = useProfileView();
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
    if (isProfileTab && showSwitcher && !switcherShownOnceRef.current) {
      switcherShownOnceRef.current = true;
      openSwitcher();
    }
  }, [isProfileTab, showSwitcher, openSwitcher]);

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
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: "#ffffff",
        tabBarActiveBackgroundColor: theme.colors.cream,
        tabBarInactiveBackgroundColor: theme.colors.primary,
        tabBarStyle: {
          backgroundColor: theme.colors.primary,
          borderTopColor: theme.colors.primary,
          borderTopWidth: 2,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "500" },
        headerShown: useClientOnlyValue(false, true),
        headerStyle: { backgroundColor: theme.colors.primary },
        headerTintColor: "#ffffff",
        headerTitle: route.name === "my-community" ? () => <ProfileHeaderTitle /> : undefined,
        headerLeft:
          route.name === "home"
            ? () => (
                <Pressable
                  style={{ marginLeft: 16 }}
                  onPress={() => router.push("/scanner" as import("expo-router").Href)}
                >
                  {({ pressed }) => (
                    <Ionicons
                      name="camera"
                      size={22}
                      color="#ffffff"
                      style={{ opacity: pressed ? 0.7 : 1 }}
                    />
                  )}
                </Pressable>
              )
            : route.name === "my-community" || route.name === "index"
              ? () => (
                  <Pressable
                    style={{ marginLeft: 16 }}
                    onPress={() => router.push("/messages")}
                  >
                    {({ pressed }) => (
                      <View style={{ position: "relative" }}>
                        <Ionicons
                          name="mail"
                          size={22}
                          color="#ffffff"
                          style={{ opacity: pressed ? 0.7 : 1 }}
                        />
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
                    )}
                  </Pressable>
                )
              : undefined,
        headerRight: route.name === "support-local"
          ? () => (
              <Pressable
                style={{ marginRight: 16 }}
                onPress={() => router.push("/scanner" as import("expo-router").Href)}
              >
                {({ pressed }) => (
                  <Ionicons
                    name="camera"
                    size={24}
                    color="#ffffff"
                    style={{ opacity: pressed ? 0.5 : 1 }}
                  />
                )}
              </Pressable>
            )
          : route.name === "my-community" && profileView === "business_hub"
            ? () => (
                <Pressable
                  style={{ marginRight: 16 }}
                  onPress={() => openBusinessQRRef.current?.()}
                >
                  {({ pressed }) => (
                    <Ionicons
                      name="qr-code"
                      size={24}
                      color="#ffffff"
                      style={{ opacity: pressed ? 0.7 : 1 }}
                    />
                  )}
                </Pressable>
              )
            : () => (
                <Pressable
                  style={{ marginRight: 16 }}
                  onPress={() => openSideMenu(route.name)}
                >
                  {({ pressed }) => (
                    <Ionicons
                      name="menu"
                      size={24}
                      color="#ffffff"
                      style={{ opacity: pressed ? 0.5 : 1 }}
                    />
                  )}
                </Pressable>
              ),
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
          tabBarLabel: "Local",
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
      hasSponsor={hasSponsor}
    />
    <AppNavMenu
      visible={sideMenuType === "app"}
      onClose={() => setSideMenuType(null)}
      hasSponsor={hasSponsor}
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
