import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Image,
  ImageBackground,
  ScrollView,
  View as RNView,
  Text,
  Modal,
  Dimensions,
  Alert,
  Linking,
  Platform,
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { Image as ExpoImage } from "expo-image";
import * as Sharing from "expo-sharing";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text as ThemedText, View } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { useProfileView } from "@/contexts/ProfileViewContext";
import { useCreatePost } from "@/contexts/CreatePostContext";
import { useOpenSellerMenu, openBusinessQRRef } from "./_layout";
import { CouponFormModal } from "@/components/CouponFormModal";
import { RewardFormModal } from "@/components/RewardFormModal";
import { PostEventForm } from "@/components/PostEventForm";
import { QRCodeDisplayModal } from "@/components/QRCodeDisplayModal";
import { apiGet, getToken } from "@/lib/api";
import { getBadgeIcon } from "@/lib/badge-icons";
import {
  businessImageRequestHeaders,
  hubBusinessHeroImageUri,
} from "@/lib/business-logo-display";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type MyBusiness = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  photos: string[];
};

function possessiveBusinessLine1(name: string): string {
  const t = name.trim();
  if (!t) return "Your";
  return /s$/i.test(t) ? `${t}'` : `${t}'s`;
}

function businessLogoInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) {
    const w = parts[0]!;
    return w.length >= 2 ? w.slice(0, 2).toUpperCase() : w.toUpperCase();
  }
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

/** Same public payload as `app/business/[slug].tsx` — fills logo when `mine=1` is missing fields. */
async function enrichMineBusinessesWithPublicLogos(list: MyBusiness[]): Promise<MyBusiness[]> {
  return Promise.all(
    list.map(async (b) => {
      try {
        const pub = await apiGet<{
          logoUrl?: string | null;
          photos?: unknown;
        }>(`/api/businesses?slug=${encodeURIComponent(b.slug)}`);
        const pubLogo = stringOrNull(pub.logoUrl);
        const pubPhotos = Array.isArray(pub.photos)
          ? pub.photos.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
          : [];
        return {
          ...b,
          logoUrl: b.logoUrl ?? pubLogo,
          photos: b.photos.length > 0 ? b.photos : pubPhotos,
        };
      } catch {
        return b;
      }
    })
  );
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "=";
    out += i + 2 < bytes.length ? B64[c & 63] : "=";
  }
  return out;
}
const { width: SCREEN_WIDTH } = Dimensions.get("window");

/** Business Hub hero logo: 1.3× the standard 72px hub icon. */
const BUSINESS_HUB_LOGO_PX = Math.round(72 * 1.3);
const BUSINESS_HUB_LOGO_RADIUS = BUSINESS_HUB_LOGO_PX / 2;

function SellerHubContent() {
  const router = useRouter();
  const { member, subscriptionPlan } = useAuth();
  const { setProfileView } = useProfileView();
  const openSellerMenu = useOpenSellerMenu();
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [pendingPickups, setPendingPickups] = useState(0);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [sellerSetupComplete, setSellerSetupComplete] = useState(false);

  const hasSeller = member?.subscriptions?.some((s) => s.plan === "seller") ?? false;

  useFocusEffect(
    useCallback(() => {
      if (hasSeller) {
        apiGet<{
          pendingShip?: number;
          pendingDeliveries?: number;
          pendingPickups?: number;
          pendingReturns?: number;
        }>("/api/seller-hub/pending-actions")
          .then((data) => {
            setPendingShip(Number(data.pendingShip) || 0);
            setPendingDeliveries(Number(data.pendingDeliveries) || 0);
            setPendingPickups(Number(data.pendingPickups) || 0);
            setPendingReturns(Number(data.pendingReturns) || 0);
          })
          .catch(() => {});
      }
    }, [hasSeller])
  );

  useFocusEffect(
    useCallback(() => {
      if (!hasSeller) return;
      let cancelled = false;
      (async () => {
        try {
          const [funds, shipping, me] = await Promise.all([
            apiGet<{ hasStripeConnect?: boolean } | { error?: string }>("/api/seller-funds"),
            apiGet<{ connected?: boolean } | { error?: string }>("/api/shipping/status"),
            apiGet<{
              sellerShippingPolicy?: string | null;
              sellerLocalDeliveryPolicy?: string | null;
              sellerPickupPolicy?: string | null;
              sellerReturnPolicy?: string | null;
            }>("/api/me"),
          ]);
          if (cancelled) return;
          const stripe = Boolean((funds as { hasStripeConnect?: boolean }).hasStripeConnect);
          const shippo = Boolean((shipping as { connected?: boolean }).connected);
          const p = me as {
            sellerShippingPolicy?: string | null;
            sellerLocalDeliveryPolicy?: string | null;
            sellerPickupPolicy?: string | null;
            sellerReturnPolicy?: string | null;
          };
          const anyPolicy = [
            p?.sellerShippingPolicy,
            p?.sellerLocalDeliveryPolicy,
            p?.sellerPickupPolicy,
            p?.sellerReturnPolicy,
          ].some((v) => typeof v === "string" && v.trim().length > 0);
          setSellerSetupComplete(stripe && shippo && anyPolicy);
        } catch {
          if (!cancelled) setSellerSetupComplete(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [hasSeller])
  );

  if (!hasSeller) {
    return (
      <View style={[styles.container, styles.planGateFill]}>
        <View style={[styles.tanSection, { padding: 24, alignItems: "center" }]}>
          <Text style={[styles.businessHubButtonTitle, { marginBottom: 12, textAlign: "center" }]}>
            Seller Hub
          </Text>
          <Text style={[styles.businessHubButtonDesc, { marginBottom: 16, textAlign: "center" }]}>
            Seller Hub is available to members on the Seller plan. Subscribe to unlock storefront
            listing and order management.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.editProfileButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() =>
              router.push(
                `/web?url=${encodeURIComponent(`${siteBase}/support-nwc`)}&title=${encodeURIComponent("View plans")}`
              )
            }
          >
            <ThemedText style={styles.editProfileButtonText}>View plans</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  const gridActions: {
    label: string;
    href?: string;
    onPress?: () => void;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = useMemo(
    () => [
      { label: "List Items", href: "/seller-hub/store/new", icon: "add-circle" },
      { label: "Orders / To Ship", href: "/seller-hub/orders", icon: "receipt" },
      { label: "Storefront Info", href: "/seller-hub/store", icon: "storefront" },
      { label: "Manage Store", href: "/seller-hub/store/manage", icon: "list" },
      { label: "Deliveries", href: "/seller-hub/deliveries", icon: "car-outline" },
      { label: "Pick Up", href: "/seller-hub/pickups", icon: "hand-left-outline" },
      { label: "Payouts", href: "/seller-hub/store/payouts", icon: "wallet" },
      {
        label: sellerSetupComplete ? "Seller Variables" : "Before You Start",
        href: "/seller-hub/before-you-start",
        icon: "checkbox-outline",
      },
    ],
    [sellerSetupComplete]
  );

  const hubBadgeForLabel = useCallback(
    (label: string) => {
      if (label === "Orders / To Ship") return pendingShip > 0;
      if (label === "Deliveries") return pendingDeliveries > 0;
      if (label === "Pick Up") return pendingPickups > 0;
      return false;
    },
    [pendingDeliveries, pendingPickups, pendingShip]
  );

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.sellerHubScroll}
        contentContainerStyle={styles.sellerHubContent}
      >
        <RNView style={styles.sellerHubHero}>
          <RNView style={styles.sellerHubHeroText}>
            <Text style={styles.sellerHubTitle}>Seller Hub</Text>
            <Text style={styles.sellerHubSubtitle}>
              Manage your storefront and resale listings, ship orders, get paid.
            </Text>
          </RNView>
          <RNView style={styles.sellerHubIconCircle}>
            <Ionicons name="briefcase" size={40} color={theme.colors.primary} />
          </RNView>
        </RNView>

        <RNView style={styles.sellerHubGrid}>
          {gridActions.map((action) => {
            const needsAction = hubBadgeForLabel(action.label);
            return (
              <Pressable
                key={action.href ?? action.label}
                style={({ pressed }) => [
                  styles.sellerHubGridButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={
                  action.onPress
                    ? action.onPress
                    : () => action.href && (router.push as (href: string) => void)(action.href)
                }
              >
                {needsAction && (
                  <RNView style={styles.hubAlertBadge}>
                    <Text style={styles.hubAlertBadgeText}>!</Text>
                  </RNView>
                )}
                <Ionicons name={action.icon} size={28} color={theme.colors.primary} />
                <ThemedText style={styles.sellerHubGridLabel}>{action.label}</ThemedText>
              </Pressable>
            );
          })}
        </RNView>

        <RNView style={styles.sellerHubFooter}>
          <Pressable
            style={({ pressed }) => [styles.sellerHubLink, pressed && styles.buttonPressed]}
            onPress={() => setProfileView("business_hub")}
          >
            <Text style={styles.sellerHubLinkText}>Go to Business Hub →</Text>
          </Pressable>
        </RNView>
      </ScrollView>
    </View>
  );
}

function ResaleHubContent() {
  const router = useRouter();
  const { member } = useAuth();
  const { setProfileView } = useProfileView();
  const canAccessResaleHub = member?.hasResaleHubAccess ?? false;
  const [resaleSetupComplete, setResaleSetupComplete] = useState(false);
  const [pendingShip, setPendingShip] = useState(0);
  const [pendingDeliveries, setPendingDeliveries] = useState(0);
  const [pendingPickups, setPendingPickups] = useState(0);
  const [sellerOffersPending, setSellerOffersPending] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (canAccessResaleHub) {
        apiGet<{
          pendingShip?: number;
          pendingDeliveries?: number;
          pendingPickups?: number;
          sellerOffersPending?: number;
        }>("/api/seller-hub/pending-actions")
          .then((data) => {
            setPendingShip(Number(data.pendingShip) || 0);
            setPendingDeliveries(Number(data.pendingDeliveries) || 0);
            setPendingPickups(Number(data.pendingPickups) || 0);
            setSellerOffersPending(Number(data.sellerOffersPending) || 0);
          })
          .catch(() => {});
      }
    }, [canAccessResaleHub])
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const [funds, shipping, me] = await Promise.all([
            apiGet<{ hasStripeConnect?: boolean } | { error?: string }>("/api/seller-funds"),
            apiGet<{ connected?: boolean } | { error?: string }>("/api/shipping/status"),
            apiGet<{
              sellerShippingPolicy?: string | null;
              sellerLocalDeliveryPolicy?: string | null;
              sellerPickupPolicy?: string | null;
              sellerReturnPolicy?: string | null;
            }>("/api/me"),
          ]);
          if (cancelled) return;
          const stripe = Boolean((funds as { hasStripeConnect?: boolean }).hasStripeConnect);
          const shippo = Boolean((shipping as { connected?: boolean }).connected);
          const p = me as {
            sellerShippingPolicy?: string | null;
            sellerLocalDeliveryPolicy?: string | null;
            sellerPickupPolicy?: string | null;
            sellerReturnPolicy?: string | null;
          };
          const anyPolicy = [
            p?.sellerShippingPolicy,
            p?.sellerLocalDeliveryPolicy,
            p?.sellerPickupPolicy,
            p?.sellerReturnPolicy,
          ].some((v) => typeof v === "string" && v.trim().length > 0);
          setResaleSetupComplete(stripe && shippo && anyPolicy);
        } catch {
          if (!cancelled) setResaleSetupComplete(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [])
  );

  if (!canAccessResaleHub) {
    return (
      <View style={[styles.container, styles.planGateFill]}>
        <View style={[styles.tanSection, { padding: 24, alignItems: "center" }]}>
          <Text style={[styles.businessHubButtonTitle, { marginBottom: 12, textAlign: "center" }]}>
            Resale Hub
          </Text>
          <Text style={[styles.businessHubButtonDesc, { marginBottom: 16, textAlign: "center" }]}>
            Resale Hub is included with the Resident Subscribe plan ($10/mo). Business and Seller plans use Business Hub and Seller Hub; add Subscribe for the member resale experience and coupon book.
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.editProfileButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={() =>
              router.push(
                `/web?url=${encodeURIComponent(`${siteBase}/support-nwc`)}&title=${encodeURIComponent("View plans")}`
              )
            }
          >
            <ThemedText style={styles.editProfileButtonText}>View plans</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  const gridActions: {
    label: string;
    href?: string;
    onPress?: () => void;
    icon: keyof typeof Ionicons.glyphMap;
  }[] = [
    { label: "List Item", href: "/resale-hub/list", icon: "add-circle" },
    {
      label: "My Listings",
      href: "/seller-hub/store/items?listingType=resale",
      icon: "list-outline",
    },
    { label: "Orders / To Ship", href: "/seller-hub/orders", icon: "receipt" },
    { label: "Offers", href: "/resale-hub/offers", icon: "pricetag-outline" },
    { label: "Deliveries", href: "/seller-hub/deliveries", icon: "car-outline" },
    { label: "Pick Ups", href: "/resale-hub/pickups", icon: "hand-left-outline" },
    { label: "Payouts", href: "/seller-hub/store/payouts", icon: "wallet" },
    {
      label: resaleSetupComplete ? "Store Variables" : "Before You Start",
      href: "/resale-hub/before-you-start",
      icon: "checkbox-outline",
    },
  ];

  const resaleHubBadgeForLabel = (label: string) => {
    if (label === "Orders / To Ship") return pendingShip > 0;
    if (label === "Offers") return sellerOffersPending > 0;
    if (label === "Deliveries") return pendingDeliveries > 0;
    if (label === "Pick Ups") return pendingPickups > 0;
    return false;
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.sellerHubScroll}
        contentContainerStyle={styles.sellerHubContent}
      >
        <RNView style={styles.sellerHubHero}>
          <RNView style={styles.sellerHubHeroText}>
            <Text style={styles.sellerHubTitle}>Resale Hub</Text>
            <Text style={styles.sellerHubSubtitle}>
              List and Ship pre-loved items in our community, in NWCs Resale Storefront.
            </Text>
          </RNView>
          <RNView style={styles.sellerHubIconCircle}>
            <Ionicons name="cash-outline" size={40} color={theme.colors.primary} />
          </RNView>
        </RNView>

        <RNView style={styles.sellerHubGrid}>
          {gridActions.map((action) => {
            const needsAction = resaleHubBadgeForLabel(action.label);
            return (
            <Pressable
              key={action.href ?? action.label}
              style={({ pressed }) => [
                styles.sellerHubGridButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={
                action.onPress
                  ? action.onPress
                  : () => action.href && (router.push as (href: string) => void)(action.href)
              }
            >
              {needsAction && (
                <RNView style={styles.hubAlertBadge}>
                  <Text style={styles.hubAlertBadgeText}>!</Text>
                </RNView>
              )}
              <Ionicons name={action.icon} size={28} color={theme.colors.primary} />
              <ThemedText style={styles.sellerHubGridLabel}>{action.label}</ThemedText>
            </Pressable>
            );
          })}
        </RNView>

        <RNView style={styles.sellerHubFooter}>
          <Pressable
            style={({ pressed }) => [styles.sellerHubLink, pressed && styles.buttonPressed]}
            onPress={() => setProfileView("profile")}
          >
            <Text style={styles.sellerHubLinkText}>Go to Profile →</Text>
          </Pressable>
        </RNView>
      </ScrollView>
    </View>
  );
}

export default function MyCommunityScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ open?: string }>();
  const { member, subscriptionPlan, loading, refreshMember } = useAuth();
  const { profileView, hasSeller, hasSubscriber, setProfileView } = useProfileView();
  const openCreatePostAsBusiness = useCreatePost()?.openCreatePostAsBusiness;

  useFocusEffect(
    useCallback(() => {
      refreshMember();
    }, [refreshMember])
  );

  const showBusinessHub = profileView === "business_hub";
  const showSellerHub = profileView === "seller_hub";
  const showResaleHub = profileView === "resale_hub";

  const [couponModalVisible, setCouponModalVisible] = useState(false);
  const [rewardModalVisible, setRewardModalVisible] = useState(false);
  const [eventModalVisible, setEventModalVisible] = useState(false);
  const [businesses, setBusinesses] = useState<MyBusiness[]>([]);
  const [activeBusinessId, setActiveBusinessId] = useState<string | null>(null);
  const [hubBusinessSwitcherOpen, setHubBusinessSwitcherOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [showQRBusiness, setShowQRBusiness] = useState<{ id: string; name: string } | null>(null);
  const [hubLogoLoadFailed, setHubLogoLoadFailed] = useState(false);
  const [profileBadges, setProfileBadges] = useState<
    { id: string; badge: { slug: string; name: string }; displayOnProfile: boolean }[]
  >([]);
  const [pendingIncomingFriendRequests, setPendingIncomingFriendRequests] = useState(0);

  useFocusEffect(
    useCallback(() => {
      apiGet<{
        memberBadges: { id: string; badge: { slug: string; name: string }; displayOnProfile: boolean }[];
      }>("/api/me/badges")
        .then((data) => {
          const visible = (data?.memberBadges ?? []).filter((b) => b.displayOnProfile);
          setProfileBadges(visible);
        })
        .catch(() => setProfileBadges([]));
    }, [])
  );

  useFocusEffect(
    useCallback(() => {
      if (!member) {
        setPendingIncomingFriendRequests(0);
        return;
      }
      apiGet<{ incoming?: { id: string }[] }>("/api/friend-requests")
        .then((d) =>
          setPendingIncomingFriendRequests(Array.isArray(d?.incoming) ? d.incoming.length : 0)
        )
        .catch(() => setPendingIncomingFriendRequests(0));
    }, [member?.id])
  );

  useFocusEffect(
    useCallback(() => {
      if (profileView !== "business_hub") return;
      let cancelled = false;
      (async () => {
        try {
          const data = await apiGet<MyBusiness[] | { error: string }>("/api/businesses?mine=1");
          if (cancelled) return;
          if (!Array.isArray(data)) {
            setBusinesses([]);
            return;
          }
          const mapped: MyBusiness[] = data.map((b) => ({
            id: b.id,
            name: b.name,
            slug: b.slug,
            logoUrl: stringOrNull(b.logoUrl),
            coverPhotoUrl: stringOrNull(b.coverPhotoUrl),
            photos: Array.isArray(b.photos)
              ? b.photos.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
              : [],
          }));
          const enriched = await enrichMineBusinessesWithPublicLogos(mapped);
          if (!cancelled) setBusinesses(enriched);
        } catch {
          if (!cancelled) setBusinesses([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [profileView])
  );

  useFocusEffect(
    useCallback(() => {
      if (profileView === "business_hub" && params.open) {
        if (params.open === "coupon") {
          setCouponModalVisible(true);
          router.replace("/(tabs)/my-community" as never);
        } else if (params.open === "reward") {
          setRewardModalVisible(true);
          router.replace("/(tabs)/my-community" as never);
        }
      }
    }, [profileView, params.open])
  );

  useEffect(() => {
    setActiveBusinessId((prev) => {
      if (businesses.length === 0) return null;
      if (prev && businesses.some((b) => b.id === prev)) return prev;
      return businesses[0]!.id;
    });
  }, [businesses]);

  const activeBusiness = useMemo(() => {
    if (businesses.length === 0) return null;
    if (activeBusinessId) {
      const found = businesses.find((b) => b.id === activeBusinessId);
      if (found) return found;
    }
    return businesses[0] ?? null;
  }, [businesses, activeBusinessId]);

  const hubHeroLogoUri = useMemo(() => {
    if (!activeBusiness) return undefined;
    return hubBusinessHeroImageUri(activeBusiness);
  }, [activeBusiness]);

  useEffect(() => {
    setHubLogoLoadFailed(false);
  }, [hubHeroLogoUri]);

  useFocusEffect(
    useCallback(() => {
      if (profileView !== "business_hub") {
        openBusinessQRRef.current = null;
        return;
      }
      openBusinessQRRef.current = () => {
        if (businesses.length === 0) {
          Alert.alert("No businesses", "Add a business first to show your QR code.");
          return;
        }
        const b = activeBusiness;
        if (!b) return;
        setShowQRBusiness({ id: b.id, name: b.name });
      };
      return () => {
        openBusinessQRRef.current = null;
      };
    }, [profileView, businesses, activeBusiness])
  );

  const openBusinessSetup = () => {
    (router.push as (href: string) => void)("/sponsor-business");
  };

  const handleDownloadFlyer = async (businessId: string, slug: string) => {
    const token = await getToken();
    if (!token) {
      Alert.alert("Sign in required", "Please sign in to download.");
      return;
    }
    setDownloading(true);
    try {
      const url = `${API_BASE}/api/businesses/${businessId}/flyer`;
      const filename = `nwc-flyer-${slug}.pdf`;
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) {
        throw new Error("File system not available on this device.");
      }
      const fileUri = `${cacheDir}${filename}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Request failed (${res.status})`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const base64 = uint8ArrayToBase64(bytes);

      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: "base64",
      });

      const shareable = await Sharing.isAvailableAsync();
      if (shareable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "application/pdf",
          dialogTitle: "Save Flyer",
        });
      } else {
        const canOpen = await Linking.canOpenURL(fileUri);
        if (canOpen) {
          await Linking.openURL(fileUri);
        } else {
          Alert.alert("Downloaded", "File saved. Check your device storage.");
        }
      }
    } catch (e) {
      Alert.alert("Download failed", (e as Error).message ?? "Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadQR = async (businessId: string, slug: string) => {
    const token = await getToken();
    if (!token) {
      Alert.alert("Sign in required", "Please sign in to download.");
      return;
    }
    setDownloading(true);
    try {
      const url = `${API_BASE}/api/businesses/${businessId}/qr`;
      const filename = `nwc-qr-${slug}.png`;
      const cacheDir = FileSystem.cacheDirectory;
      if (!cacheDir) {
        throw new Error("File system not available on this device.");
      }
      const fileUri = `${cacheDir}${filename}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Request failed (${res.status})`);
      }
      const arrayBuffer = await res.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      const base64 = uint8ArrayToBase64(bytes);

      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: "base64",
      });

      const shareable = await Sharing.isAvailableAsync();
      if (shareable) {
        await Sharing.shareAsync(fileUri, {
          mimeType: "image/png",
          dialogTitle: "Save QR Code",
        });
      } else {
        const canOpen = await Linking.canOpenURL(fileUri);
        if (canOpen) {
          await Linking.openURL(fileUri);
        } else {
          Alert.alert("Downloaded", "File saved. Check your device storage.");
        }
      }
    } catch (e) {
      Alert.alert("Download failed", (e as Error).message ?? "Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const promptDownload = (type: "qr" | "flyer") => {
    if (businesses.length === 0 || !activeBusiness) {
      Alert.alert("No businesses", "Add a business first to download a QR code or flyer.");
      return;
    }
    type === "qr"
      ? handleDownloadQR(activeBusiness.id, activeBusiness.slug)
      : handleDownloadFlyer(activeBusiness.id, activeBusiness.slug);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!member) {
    return (
      <View style={styles.center}>
        <Text style={styles.guestPromptTitle}>Sign in to view profile</Text>
        <Text style={styles.guestPromptDesc}>
          Create an account or sign in to access your profile, saved items, and more.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.guestSignInBtn, pressed && { opacity: 0.8 }]}
          onPress={() => router.replace("/(auth)/login")}
        >
          <ThemedText style={styles.guestSignInBtnText}>Sign in</ThemedText>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.guestMaybeLaterBtn, pressed && { opacity: 0.8 }]}
          onPress={() => router.replace("/(tabs)")}
        >
          <Text style={styles.guestMaybeLaterText}>Maybe later</Text>
        </Pressable>
      </View>
    );
  }

  const initials = `${member.firstName?.[0] ?? ""}${member.lastName?.[0] ?? ""}`.toUpperCase() || "?";

  if (showBusinessHub) {
    const businessHubActions: {
      label: string;
      onPress: () => void;
      icon: keyof typeof Ionicons.glyphMap;
    }[] = [
      {
        label: "Set up / Edit Business Page",
        icon: "business",
        onPress: () => (router.push as (href: string) => void)("/sponsor-business"),
      },
      ...(openCreatePostAsBusiness && businesses.length > 0 && activeBusiness
        ? [
            {
              label: "Create Post",
              icon: "megaphone" as const,
              onPress: () => {
                openCreatePostAsBusiness({
                  id: activeBusiness.id,
                  name: activeBusiness.name,
                });
              },
            },
          ]
        : []),
      {
        label: "Post Event",
        icon: "calendar",
        onPress: () => setEventModalVisible(true),
      },
      {
        label: "Create Coupon",
        icon: "pricetag",
        onPress: () => setCouponModalVisible(true),
      },
      {
        label: "Offer a Reward",
        icon: "gift",
        onPress: () => setRewardModalVisible(true),
      },
      {
        label: "Redeemed Rewards",
        icon: "receipt-outline",
        onPress: () => (router.push as (href: string) => void)("/redeemed-rewards"),
      },
    ];

    return (
      <View style={styles.container}>
        <ScrollView
          style={styles.businessHubScroll}
          contentContainerStyle={styles.businessHubContent}
        >
          <RNView style={styles.sellerHubHero}>
            <RNView style={styles.businessHubHeroText}>
              {businesses.length === 0 ? (
                <>
                  <Text style={styles.businessHubHeroLine1}>Your</Text>
                  <Text style={styles.sellerHubTitle}>Business Hub</Text>
                </>
              ) : businesses.length === 1 ? (
                <>
                  <Text style={styles.businessHubHeroLine1}>
                    {possessiveBusinessLine1(activeBusiness?.name ?? "")}
                  </Text>
                  <Text style={styles.sellerHubTitle}>Business Hub</Text>
                </>
              ) : (
                <>
                  <Pressable
                    style={({ pressed }) => [
                      styles.businessHubHeroLine1Press,
                      pressed && { opacity: 0.75 },
                    ]}
                    onPress={() => setHubBusinessSwitcherOpen(true)}
                  >
                    <Text style={styles.businessHubHeroLine1}>
                      {possessiveBusinessLine1(activeBusiness?.name ?? "")}
                    </Text>
                    <Ionicons name="chevron-down" size={20} color={theme.colors.primary} />
                  </Pressable>
                  <Text style={styles.sellerHubTitle}>Business Hub</Text>
                </>
              )}
              <Text style={styles.sellerHubSubtitle}>
                Give residents a reason to support local. Offer Coupons, Rewards, & Post Events
              </Text>
            </RNView>
            <RNView style={styles.businessHubHeroLogoColumn}>
              <RNView style={styles.businessHubHeroLogoSlot}>
                {(() => {
                  const logoUri =
                    businesses.length > 0 ? hubHeroLogoUri : undefined;
                  const a11yLabel =
                    activeBusiness != null
                      ? `${activeBusiness.name} logo`
                      : "Business logo";
                  if (logoUri && !hubLogoLoadFailed) {
                    const headers = businessImageRequestHeaders();
                    return (
                      <ExpoImage
                        source={
                          headers
                            ? { uri: logoUri, headers }
                            : { uri: logoUri }
                        }
                        style={styles.businessHubHeroLogoImage}
                        contentFit="contain"
                        contentPosition="center"
                        cachePolicy="memory-disk"
                        accessibilityLabel={a11yLabel}
                        onError={() => setHubLogoLoadFailed(true)}
                      />
                    );
                  }
                  return (
                    <RNView
                      style={[
                        styles.businessHubHeroLogoImage,
                        styles.sellerHubPhotoPlaceholder,
                      ]}
                      accessibilityLabel={a11yLabel}
                    >
                      <Text style={styles.businessHubLogoInitialsLarge}>
                        {activeBusiness != null
                          ? businessLogoInitials(activeBusiness.name)
                          : "?"}
                      </Text>
                    </RNView>
                  );
                })()}
              </RNView>
            </RNView>
          </RNView>

          <RNView style={styles.sellerHubGrid}>
            {businessHubActions.map((action) => (
              <Pressable
                key={action.label}
                style={({ pressed }) => [
                  styles.sellerHubGridButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={action.onPress}
              >
                <Ionicons name={action.icon} size={28} color={theme.colors.primary} />
                <ThemedText style={styles.sellerHubGridLabel}>{action.label}</ThemedText>
              </Pressable>
            ))}
          </RNView>

          <RNView style={styles.businessHubDownloadSection}>
            <Text style={styles.downloadSectionTitle}>Manage</Text>
            <Pressable
              style={({ pressed }) => [
                styles.showQRButton,
                pressed && { opacity: 0.85 },
              ]}
              onPress={() => (router.push as (href: string) => void)("/business-hub-manage")}
            >
              <Ionicons name="folder-outline" size={28} color="#fff" />
              <Text style={styles.showQRButtonText}>Business Offers & Publicity</Text>
            </Pressable>
          </RNView>

          {businesses.length > 0 && (
            <RNView style={styles.businessHubDownloadSection}>
              <Text style={styles.downloadSectionTitle}>QR Code</Text>
              <Pressable
                style={({ pressed }) => [
                  styles.showQRButton,
                  pressed && { opacity: 0.85 },
                ]}
                onPress={() => {
                  if (activeBusiness) {
                    setShowQRBusiness({ id: activeBusiness.id, name: activeBusiness.name });
                  }
                }}
              >
                <Ionicons name="qr-code" size={28} color="#fff" />
                <Text style={styles.showQRButtonText}>Show My QR Code</Text>
              </Pressable>
              <Text style={styles.downloadHint}>
                Show this QR code to customers so they can scan it and earn reward points for supporting
                your business.
              </Text>

              <Text style={[styles.downloadSectionTitle, { marginTop: 20 }]}>Download</Text>
              <RNView style={styles.sellerHubGrid}>
                <Pressable
                  style={({ pressed }) => [
                    styles.sellerHubGridButton,
                    downloading && styles.downloadBtnDisabled,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => promptDownload("qr")}
                  disabled={downloading}
                >
                  {downloading ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="qr-code" size={28} color={theme.colors.primary} />
                      <ThemedText style={styles.sellerHubGridLabel}>QR Code</ThemedText>
                    </>
                  )}
                </Pressable>
                <Pressable
                  style={({ pressed }) => [
                    styles.sellerHubGridButton,
                    downloading && styles.downloadBtnDisabled,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => promptDownload("flyer")}
                  disabled={downloading}
                >
                  {downloading ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="document-text" size={28} color={theme.colors.primary} />
                      <ThemedText style={styles.sellerHubGridLabel}>Download Flyer</ThemedText>
                    </>
                  )}
                </Pressable>
              </RNView>
              <Text style={styles.downloadHint}>
                Download the QR or print the Flyer and hang it up in your storefront.
              </Text>
            </RNView>
          )}

          {hasSeller && (
            <RNView style={styles.sellerHubFooter}>
              <Pressable
                style={({ pressed }) => [styles.sellerHubLink, pressed && styles.buttonPressed]}
                onPress={() => setProfileView("seller_hub")}
              >
                <Text style={styles.sellerHubLinkText}>Go to Seller Hub →</Text>
              </Pressable>
            </RNView>
          )}
        </ScrollView>

        <Modal
          visible={hubBusinessSwitcherOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setHubBusinessSwitcherOpen(false)}
        >
          <Pressable
            style={styles.hubBusinessSwitcherBackdrop}
            onPress={() => setHubBusinessSwitcherOpen(false)}
          >
            <RNView
              style={styles.hubBusinessSwitcherSheet}
              onStartShouldSetResponder={() => true}
            >
              {businesses.map((b, i) => (
                <Pressable
                  key={b.id}
                  style={({ pressed }) => [
                    styles.hubBusinessSwitcherRow,
                    i < businesses.length - 1 && styles.hubBusinessSwitcherRowBorder,
                    activeBusiness?.id === b.id && styles.hubBusinessSwitcherRowActive,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => {
                    setActiveBusinessId(b.id);
                    setHubBusinessSwitcherOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.hubBusinessSwitcherRowText,
                      activeBusiness?.id === b.id && styles.hubBusinessSwitcherRowTextActive,
                    ]}
                  >
                    {b.name}
                  </Text>
                </Pressable>
              ))}
            </RNView>
          </Pressable>
        </Modal>

        <CouponFormModal
          visible={couponModalVisible}
          onClose={() => setCouponModalVisible(false)}
          onSuccess={() => setCouponModalVisible(false)}
          onOpenBusinessSetup={openBusinessSetup}
          initialBusinessId={activeBusiness?.id ?? null}
        />
        <RewardFormModal
          visible={rewardModalVisible}
          onClose={() => setRewardModalVisible(false)}
          onSuccess={() => setRewardModalVisible(false)}
          onOpenBusinessSetup={openBusinessSetup}
          initialBusinessId={activeBusiness?.id ?? null}
        />
        <Modal
          visible={eventModalVisible}
          animationType="slide"
          onRequestClose={() => setEventModalVisible(false)}
        >
          <View style={styles.eventModalContainer}>
            <View style={[styles.eventModalHeader, { paddingTop: 48 }]}>
              <Pressable
                style={({ pressed }) => [
                  styles.eventModalCancelBtn,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => setEventModalVisible(false)}
              >
                <Text style={styles.eventModalCancelTextWhite}>Cancel</Text>
              </Pressable>
              <Text style={styles.eventModalTitleWhite}>Post Event</Text>
              <View style={styles.eventModalSpacer} />
            </View>
            <PostEventForm
              key={`hub-event-${activeBusiness?.id ?? "none"}`}
              postEventAs={
                activeBusiness
                  ? {
                      businessId: activeBusiness.id,
                      displayName: activeBusiness.name,
                    }
                  : undefined
              }
              onSuccess={() => setEventModalVisible(false)}
            />
          </View>
        </Modal>

        <QRCodeDisplayModal
          visible={!!showQRBusiness}
          onClose={() => setShowQRBusiness(null)}
          businessId={showQRBusiness?.id ?? null}
          businessName={showQRBusiness?.name ?? ""}
        />
      </View>
    );
  }

  if (showSellerHub) {
    return <SellerHubContent />;
  }

  if (showResaleHub) {
    return <ResaleHubContent />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.greenSection}>
        <View style={styles.profileTop}>
          <View style={styles.avatarWrap}>
            {member.profilePhotoUrl ? (
              <Image
                source={{ uri: member.profilePhotoUrl }}
                style={styles.avatar}
                accessibilityLabel="Profile photo"
              />
            ) : (
              <View style={styles.avatarPlaceholder}>
                {initials !== "?" ? (
                  <ThemedText style={styles.avatarInitials}>{initials}</ThemedText>
                ) : (
                  <Ionicons name="person" size={56} color={theme.colors.primary} />
                )}
              </View>
            )}
          </View>
          <ThemedText style={styles.nameText} numberOfLines={1}>
            {member.firstName} {member.lastName}
          </ThemedText>
          <ThemedText style={styles.cityText} numberOfLines={1}>
            {member.city || "City"}
          </ThemedText>
          <View style={styles.profileDivider} />
          <ThemedText style={styles.bioText} numberOfLines={6}>
            {member.bio || "Add a bio in Edit Profile"}
          </ThemedText>
          <View style={styles.profileDivider} />
          <RNView style={styles.profileBioActionRow}>
            <Pressable
              style={({ pressed }) => [
                styles.profileBioActionButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => router.push("/profile-edit")}
            >
              <Ionicons name="create-outline" size={20} color="#fff" />
              <ThemedText style={styles.editProfileButtonText}>Edit Profile</ThemedText>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.profileBioActionButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={() => (router.push as (href: string) => void)("/notifications")}
            >
              <Ionicons name="notifications-outline" size={20} color="#fff" />
              <ThemedText style={styles.editProfileButtonText}>Notifications</ThemedText>
            </Pressable>
          </RNView>
          <View style={styles.profileDivider} />
        </View>

        <View style={styles.pointsRow}>
          <View style={styles.smallBox}>
            <ThemedText style={styles.smallBoxText} numberOfLines={1}>
              {member.points ?? 0} points
            </ThemedText>
          </View>
        </View>

        {profileBadges.length > 0 && (
          <Pressable
            style={({ pressed }) => [styles.badgesProfileRow, pressed && { opacity: 0.9 }]}
            onPress={() => router.push("/my-badges")}
          >
            <RNView style={styles.badgesProfileIcons}>
              {profileBadges.slice(0, 6).map((mb) => (
                <RNView key={mb.id} style={styles.badgesProfileIconWrap}>
                  <Ionicons
                    name={getBadgeIcon(mb.badge.slug)}
                    size={20}
                    color={theme.colors.primary}
                  />
                </RNView>
              ))}
              {profileBadges.length > 6 && (
                <Text style={styles.badgesProfileMore}>+{profileBadges.length - 6}</Text>
              )}
            </RNView>
            <RNView style={styles.badgesProfileLabelRow}>
              <Text style={styles.badgesProfileLabel}>
                {profileBadges.length} badge{profileBadges.length !== 1 ? "s" : ""}
              </Text>
              <Ionicons name="chevron-forward" size={16} color={theme.colors.primary} />
            </RNView>
          </Pressable>
        )}

        <Pressable
          style={({ pressed }) => [styles.postsBox, pressed && { opacity: 0.9 }]}
          onPress={() => (router.push as (href: string) => void)("/community/posts-photos")}
        >
          <ThemedText style={styles.postsBoxText}>Posted Photos / Posts</ThemedText>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </Pressable>
      </View>

      <RNView style={styles.tanSection}>
        <RNView
          style={[
            styles.buttonRow,
            pendingIncomingFriendRequests > 0 && styles.buttonRowFriendBadgeInset,
          ]}
        >
          <RNView
            style={[
              styles.tanButtonFriendWrap,
              pendingIncomingFriendRequests > 0 && styles.tanButtonFriendWrapRaised,
            ]}
          >
            <Pressable
              style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
              onPress={() => (router.push as (href: string) => void)("/community/my-friends")}
            >
              <Ionicons name="people" size={22} color="#fff" style={styles.tanButtonIcon} />
              <ThemedText style={styles.tanButtonText}>My Friends</ThemedText>
            </Pressable>
            {pendingIncomingFriendRequests > 0 ? (
              <RNView style={styles.tanButtonFriendBadge} pointerEvents="none">
                <Text style={styles.tanButtonFriendBadgeText}>!</Text>
              </RNView>
            ) : null}
          </RNView>
          <RNView style={styles.tanButtonSlot}>
            <Pressable
              style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
              onPress={() => router.push("/profile-businesses")}
            >
              <Ionicons name="business" size={22} color="#fff" style={styles.tanButtonIcon} />
              <ThemedText
                style={[styles.tanButtonText, styles.tanButtonTextMyBusinesses]}
                numberOfLines={1}
              >
                My Businesses
              </ThemedText>
            </Pressable>
          </RNView>
        </RNView>
        <RNView style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/profile-events")}
          >
            <Ionicons name="calendar" size={22} color="#fff" style={styles.tanButtonIcon} />
            <ThemedText style={styles.tanButtonText}>My Events</ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/profile-coupons")}
          >
            <Ionicons name="pricetag" size={22} color="#fff" style={styles.tanButtonIcon} />
            <ThemedText style={styles.tanButtonText}>My Coupons</ThemedText>
          </Pressable>
        </RNView>
        <RNView style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => (router.push as (href: string) => void)("/rewards/my-rewards")}
          >
            <Ionicons name="gift-outline" size={22} color="#fff" style={styles.tanButtonIcon} />
            <ThemedText style={styles.tanButtonText}>My Rewards</ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/my-badges")}
          >
            <Ionicons name="ribbon-outline" size={22} color="#fff" style={styles.tanButtonIcon} />
            <ThemedText style={styles.tanButtonText}>My Badges</ThemedText>
          </Pressable>
        </RNView>
        <RNView style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/profile-wishlist")}
          >
            <Ionicons name="heart" size={22} color="#fff" style={styles.tanButtonIcon} />
            <ThemedText style={styles.tanButtonText}>My Wishlist</ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => (router.push as (href: string) => void)("/community/my-orders")}
          >
            <Ionicons name="receipt" size={22} color="#fff" style={styles.tanButtonIcon} />
            <ThemedText style={styles.tanButtonText}>My Orders</ThemedText>
          </Pressable>
        </RNView>
      </RNView>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  guestPromptTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 8,
    textAlign: "center",
    paddingHorizontal: 24,
  },
  guestPromptDesc: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    paddingHorizontal: 32,
    marginBottom: 24,
  },
  guestSignInBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  guestSignInBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  guestMaybeLaterBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  guestMaybeLaterText: {
    fontSize: 16,
    color: theme.colors.primary,
  },
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  /** Plan / subscription gates: anchor CTA block toward bottom of tab (matches web hub gates). */
  planGateFill: {
    justifyContent: "flex-end",
    paddingBottom: 8,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  placeholderContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  placeholderText: {
    fontSize: 16,
    color: theme.colors.text,
    textAlign: "center",
  },
  greenSection: {
    flex: 1,
    padding: 20,
    backgroundColor: "#ffffff",
    paddingBottom: 24,
  },
  profileTop: {
    alignItems: "center",
    marginBottom: 16,
    gap: 12,
  },
  avatarWrap: {},
  avatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  avatarPlaceholder: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    fontSize: 44,
    fontWeight: "bold",
    color: "#000",
  },
  nameText: {
    fontSize: 20,
    fontWeight: "600",
    color: "#000",
    textAlign: "center",
  },
  cityText: {
    fontSize: 16,
    color: "#000",
    textAlign: "center",
    marginTop: -6,
  },
  profileDivider: {
    height: 2,
    backgroundColor: theme.colors.primary,
    alignSelf: "stretch",
  },
  pointsRow: {
    marginBottom: 12,
  },
  smallBox: {
    flex: 1,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 8,
    padding: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  smallBoxText: {
    fontSize: 14,
    color: "#000",
  },
  badgesProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  badgesProfileIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  badgesProfileIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: `${theme.colors.primary}15`,
    alignItems: "center",
    justifyContent: "center",
  },
  badgesProfileMore: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primary,
    marginLeft: 4,
  },
  badgesProfileLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  badgesProfileLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.primary,
  },
  bioText: {
    fontSize: 15,
    color: "#000",
    lineHeight: 22,
    textAlign: "center",
    width: 260,
    alignSelf: "center",
  },
  postsBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#000",
    borderRadius: 8,
    padding: 16,
    minHeight: 80,
    /** Same vertical gap as pointsRow → badges row → posts (see `pointsRow`, `badgesProfileRow`). */
    marginBottom: 12,
  },
  postsBoxText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  profileBioActionRow: {
    flexDirection: "row",
    gap: 12,
    alignSelf: "stretch",
  },
  profileBioActionButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 4,
    minHeight: 44,
  },
  editProfileButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: "center",
    borderRadius: 4,
    alignSelf: "flex-start",
    marginTop: 0,
  },
  editProfileButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  buttonPressed: { opacity: 0.8 },
  tanSection: {
    backgroundColor: theme.colors.cream,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#000",
  },
  businessHubTanSection: {
    marginTop: 24,
    borderWidth: 4,
    borderTopWidth: 4,
    borderColor: theme.colors.primary,
    borderTopColor: theme.colors.primary,
    backgroundColor: "transparent",
  },
  downloadSection: {
    marginTop: 24,
    paddingHorizontal: 4,
  },
  businessHubDownloadSection: {
    marginTop: 24,
  },
  downloadSectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 12,
  },
  downloadButtonRow: {
    flexDirection: "row",
    gap: 12,
  },
  downloadBtn: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  downloadBtnDisabled: {
    opacity: 0.6,
  },
  downloadBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  downloadHint: {
    fontSize: 12,
    color: "#666",
    marginTop: 8,
  },
  showQRButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 8,
  },
  showQRButtonText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
  businessPickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  businessPickerSheet: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  businessPickerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 16,
  },
  businessPickerOption: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    marginBottom: 8,
  },
  businessPickerOptionText: {
    fontSize: 16,
    color: theme.colors.heading,
    fontWeight: "500",
  },
  businessPickerCancel: {
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  businessPickerCancelText: {
    fontSize: 16,
    color: "#666",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    backgroundColor: theme.colors.cream,
  },
  /** Space so the friends notification dot can sit outside the green tile without ScrollView clipping. */
  buttonRowFriendBadgeInset: {
    paddingTop: 8,
    paddingRight: 8,
  },
  tanButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: theme.colors.primary,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    minHeight: 52,
    minWidth: 0,
    alignSelf: "stretch",
  },
  /** Matches flex behavior for both columns in a row (pair with tanButtonFriendWrap). */
  tanButtonSlot: {
    flex: 1,
    minWidth: 0,
  },
  tanButtonFriendWrap: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    overflow: "visible",
    zIndex: 0,
  },
  /** Lift stacking when badge sits outside the button so it paints above the sibling tile. */
  tanButtonFriendWrapRaised: {
    zIndex: 2,
  },
  tanButtonFriendBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 3,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.22,
        shadowRadius: 2,
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  tanButtonFriendBadgeText: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.colors.primary,
    marginTop: Platform.OS === "ios" ? -1 : 0,
  },
  tanButtonIcon: {},
  tanButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    textAlign: "left",
    flexShrink: 1,
  },
  /** Shorter than other labels so the tile stays one line and matches sibling minHeight. */
  tanButtonTextMyBusinesses: {
    ...Platform.select({
      ios: { fontSize: 15 },
      android: { fontSize: 14 },
      default: { fontSize: 15 },
    }),
  },
  businessHubScroll: {
    flex: 1,
  },
  businessHubContent: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 32,
  },
  headerPhotoWrapper: {
    height: 260,
    width: SCREEN_WIDTH,
    marginLeft: -16,
    marginRight: -16,
    marginTop: -16,
    overflow: "hidden",
  },
  headerPhoto: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  welcomeBox: {
    backgroundColor: "rgba(255, 255, 255, 1)",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignSelf: "center",
  },
  welcomeHeaderText: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
  },
  welcomeBusinessText: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
    marginTop: 8,
  },
  businessHubButtonRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
  },
  businessHubButton: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 16,
    alignItems: "flex-start",
    justifyContent: "flex-start",
  },
  businessHubButtonTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    textAlign: "left",
  },
  businessHubButtonDesc: {
    fontSize: 12,
    color: "rgba(255, 255, 255, 0.9)",
    textAlign: "left",
    marginTop: 6,
  },
  eventModalContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  eventModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.colors.primary,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.2)",
  },
  eventModalCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  eventModalCancelText: {
    fontSize: 16,
    color: theme.colors.primary,
  },
  eventModalCancelTextWhite: {
    fontSize: 16,
    color: "#fff",
  },
  eventModalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  eventModalTitleWhite: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  eventModalSpacer: {
    width: 60,
  },
  // Seller Hub redesign
  sellerHubScroll: {
    flex: 1,
  },
  sellerHubContent: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 32,
  },
  sellerHubHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginBottom: 24,
    paddingVertical: 16,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.cream,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  sellerHubHeroText: {
    flex: 1,
  },
  /** Sizes to copy; remaining row width goes to `businessHubHeroLogoColumn` so the logo centers to the tan box edge. */
  businessHubHeroText: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
  },
  businessHubHeroLogoColumn: {
    flexGrow: 1,
    flexShrink: 0,
    minWidth: BUSINESS_HUB_LOGO_PX,
    justifyContent: "center",
    alignItems: "center",
  },
  businessHubHeroLogoSlot: {
    width: BUSINESS_HUB_LOGO_PX,
    height: BUSINESS_HUB_LOGO_PX,
    borderRadius: BUSINESS_HUB_LOGO_RADIUS,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
  },
  businessHubHeroLogoImage: {
    width: BUSINESS_HUB_LOGO_PX,
    height: BUSINESS_HUB_LOGO_PX,
    alignSelf: "center",
  },
  businessHubHeroLine1: {
    fontSize: 17,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 2,
  },
  businessHubHeroLine1Press: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginBottom: 2,
  },
  hubBusinessSwitcherBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-start",
    paddingTop: 120,
    paddingHorizontal: 24,
    alignItems: "center",
  },
  hubBusinessSwitcherSheet: {
    minWidth: 260,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  hubBusinessSwitcherRow: {
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  hubBusinessSwitcherRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  hubBusinessSwitcherRowActive: {
    backgroundColor: theme.colors.cream,
  },
  hubBusinessSwitcherRowText: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  hubBusinessSwitcherRowTextActive: {
    fontWeight: "700",
  },
  sellerHubTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 6,
  },
  sellerHubSubtitle: {
    fontSize: 14,
    color: theme.colors.text,
    lineHeight: 20,
  },
  sellerHubIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sellerHubPhotoWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  sellerHubPhoto: {
    width: "100%",
    height: "100%",
  },
  sellerHubPhotoPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#e8e8e8",
    alignItems: "center",
    justifyContent: "center",
  },
  businessHubLogoInitialsLarge: {
    fontSize: Math.round(22 * 1.3),
    fontWeight: "700",
    color: theme.colors.primary,
    fontFamily: theme.fonts.heading,
  },
  sellerHubGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  sellerHubGridButton: {
    width: (SCREEN_WIDTH - 32 - 12) / 2, // screen - padding - gap
    minHeight: 100,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    padding: 16,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    position: "relative",
  },
  hubAlertBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.colors.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  hubAlertBadgeText: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#fff",
  },
  sellerHubGridLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
  },
  sellerHubFooter: {
    marginTop: 24,
    alignItems: "center",
  },
  sellerHubLink: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  sellerHubLinkText: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "600",
  },
});
