import { useEffect, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, View, Text, Modal } from "react-native";
import { Tabs, useRouter } from "expo-router";

import { useClientOnlyValue } from "@/components/useClientOnlyValue";

const openSellerMenuRef: { current: (() => void) | null } = { current: null };
export function useOpenSellerMenu() {
  return () => openSellerMenuRef.current?.();
}
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProfileView } from "@/contexts/ProfileViewContext";
import { SellerHubSideMenu } from "@/components/SellerHubSideMenu";
import { BusinessHubSideMenu } from "@/components/BusinessHubSideMenu";
import { ResaleHubSideMenu } from "@/components/ResaleHubSideMenu";
import { ProfileSideMenu } from "@/components/ProfileSideMenu";
import { AppNavMenu } from "@/components/AppNavMenu";
import { CommunitySideMenu } from "@/components/CommunitySideMenu";
import { CreatePostProvider, useCreatePost } from "@/contexts/CreatePostContext";

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

function ProfileTabButton(props: { children?: React.ReactNode; onPress?: () => void; [key: string]: unknown }) {
  const { openSwitcher } = useProfileView();
  const { onPress, children, ...rest } = props;
  return (
    <Pressable
      {...rest}
      onPress={() => {
        openSwitcher();
        onPress?.();
      }}
    >
      {children}
    </Pressable>
  );
}

function ProfileSwitcherModal() {
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
                }}
              >
                Business Hub
              </Text>
            </Pressable>
          )}
          {hasSeller && (
            <Pressable
              style={{
                paddingVertical: 14,
                paddingHorizontal: 20,
                borderBottomWidth: 1,
                borderBottomColor: "#eee",
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
                }}
              >
                Seller Hub
              </Text>
            </Pressable>
          )}
          {(hasSubscriber || hasSponsor) && (
            <Pressable
              style={{
                paddingVertical: 14,
                paddingHorizontal: 20,
                borderBottomWidth: 1,
                borderBottomColor: "#eee",
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
                }}
              >
                Resale Hub
              </Text>
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

function TabLayoutInner() {
  const theme = useTheme();
  const router = useRouter();
  const { member, subscriptionPlan, loading } = useAuth();
  const { profileView, showSwitcher, hasSponsor, hasSeller, hasSubscriber } = useProfileView();
  const [sideMenuType, setSideMenuType] = useState<SideMenuType>(null);

  useEffect(() => {
    if (!loading && !member) {
      router.replace("/(auth)/login");
    }
  }, [member, loading, router]);

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
      else if (profileView === "business_hub") setSideMenuType("business");
      else if (profileView === "resale_hub") setSideMenuType("resale");
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
                      <Ionicons
                        name="mail"
                        size={22}
                        color="#ffffff"
                        style={{ opacity: pressed ? 0.7 : 1 }}
                      />
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
          tabBarButton: showSwitcher ? (props: any) => <ProfileTabButton {...props} /> : undefined,
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
  return (
    <CreatePostProvider>
      <TabLayoutInner />
      <ProfileSwitcherModal />
    </CreatePostProvider>
  );
}
