import { useCallback, useState } from "react";
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
} from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Text as ThemedText, View } from "@/components/Themed";
import { theme } from "@/lib/theme";
import { useAuth } from "@/contexts/AuthContext";
import { useProfileView } from "@/contexts/ProfileViewContext";
import { useOpenSellerMenu } from "./_layout";
import { CouponFormModal } from "@/components/CouponFormModal";
import { RewardFormModal } from "@/components/RewardFormModal";
import { PostEventForm } from "@/components/PostEventForm";
import { apiGet, getToken } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

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

function SellerHubContent() {
  const router = useRouter();
  const { member, subscriptionPlan } = useAuth();
  const { setProfileView } = useProfileView();
  const openSellerMenu = useOpenSellerMenu();
  const [hasLocalDelivery, setHasLocalDelivery] = useState(false);
  const [loadingDelivery, setLoadingDelivery] = useState(true);

  const hasSeller = member?.subscriptions?.some((s) => s.plan === "seller") ?? false;

  useFocusEffect(
    useCallback(() => {
      if (hasSeller) {
        apiGet<{ localDeliveryAvailable?: boolean }[] | { error?: string }>(
          "/api/store-items?mine=1"
        )
          .then((data) => {
            const items = Array.isArray(data) ? data : [];
            setHasLocalDelivery(items.some((i) => i.localDeliveryAvailable === true));
          })
          .catch(() => setHasLocalDelivery(false))
          .finally(() => setLoadingDelivery(false));
      } else {
        setLoadingDelivery(false);
      }
    }, [hasSeller])
  );

  if (!hasSeller) {
    return (
      <View style={styles.container}>
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
  }[] = [
    { label: "List Items", href: "/seller-hub/store/new", icon: "add-circle" },
    {
      label: "Manage Store",
      icon: "list",
      onPress: openSellerMenu,
    },
    { label: "My Orders", href: "/seller-hub/orders", icon: "receipt" },
    { label: "Ship Orders", href: "/seller-hub/ship", icon: "paper-plane" },
    { label: "Storefront Info", href: "/seller-hub/store", icon: "storefront" },
    { label: "Payouts", href: "/seller-hub/store/payouts", icon: "wallet" },
    { label: "Policies", href: "/policies", icon: "book-outline" },
    { label: "Before You Start", href: "/seller-hub/before-you-start", icon: "checkbox" },
  ];

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
          <RNView style={styles.sellerHubPhotoWrap}>
            {member?.profilePhotoUrl ? (
              <Image
                source={{ uri: member.profilePhotoUrl }}
                style={styles.sellerHubPhoto}
                resizeMode="cover"
              />
            ) : (
              <RNView style={styles.sellerHubPhotoPlaceholder}>
                <Ionicons name="briefcase" size={40} color={theme.colors.text} />
              </RNView>
            )}
          </RNView>
        </RNView>

        <RNView style={styles.sellerHubGrid}>
          {gridActions.map((action) => (
            <Pressable
              key={action.label}
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
              <Ionicons name={action.icon} size={28} color={theme.colors.primary} />
              <ThemedText style={styles.sellerHubGridLabel}>{action.label}</ThemedText>
            </Pressable>
          ))}
        </RNView>

        {hasLocalDelivery && (
          <RNView style={styles.sellerHubExtra}>
            <Pressable
              style={({ pressed }) => [styles.sellerHubExtraButton, pressed && styles.buttonPressed]}
              onPress={() => (router.push as (href: string) => void)("/seller-hub/deliveries")}
            >
              <Ionicons name="bicycle" size={20} color="#fff" />
              <Text style={styles.sellerHubExtraText}>My Deliveries</Text>
            </Pressable>
          </RNView>
        )}

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
  const isSubscriber = member?.isSubscriber ?? false;
  const hasSponsor = member?.subscriptions?.some((s) => s.plan === "sponsor") ?? false;
  const canAccessResaleHub = isSubscriber || hasSponsor;

  if (!canAccessResaleHub) {
    return (
      <View style={styles.container}>
        <View style={[styles.tanSection, { padding: 24, alignItems: "center" }]}>
          <Text style={[styles.businessHubButtonTitle, { marginBottom: 12, textAlign: "center" }]}>
            Resale Hub
          </Text>
          <Text style={[styles.businessHubButtonDesc, { marginBottom: 16, textAlign: "center" }]}>
            Resale Hub is available to subscribers and sponsors. Subscribe or become a sponsor to browse and buy from Community Resale.
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
    {
      label: "List Items",
      onPress: () => (router.push as (href: string) => void)("/resale-hub/list"),
      icon: "add-circle",
    },
    {
      label: "My Listings",
      onPress: () =>
        router.push(
          `/web?url=${encodeURIComponent(`${siteBase}/resale-hub/listings`)}&title=${encodeURIComponent("My Listings")}`
        ),
      icon: "list",
    },
    {
      label: "Resale Conversations",
      onPress: () =>
        (router.push as (href: string) => void)("/messages?tab=resale"),
      icon: "chatbubbles",
    },
    {
      label: "Payouts",
      onPress: () =>
        router.push(
          `/web?url=${encodeURIComponent(`${siteBase}/resale-hub/payouts`)}&title=${encodeURIComponent("My Payouts")}`
        ),
      icon: "wallet",
    },
    {
      label: "Policies",
      href: "/policies",
      icon: "book-outline",
    },
  ];

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
          <RNView style={styles.sellerHubPhotoWrap}>
            {member?.profilePhotoUrl ? (
              <Image
                source={{ uri: member.profilePhotoUrl }}
                style={styles.sellerHubPhoto}
                resizeMode="cover"
              />
            ) : (
              <RNView style={styles.sellerHubPhotoPlaceholder}>
                <Ionicons name="cash-outline" size={40} color={theme.colors.text} />
              </RNView>
            )}
          </RNView>
        </RNView>

        <RNView style={styles.sellerHubGrid}>
          {gridActions.map((action) => (
            <Pressable
              key={action.label}
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
              <Ionicons name={action.icon} size={28} color={theme.colors.primary} />
              <ThemedText style={styles.sellerHubGridLabel}>{action.label}</ThemedText>
            </Pressable>
          ))}
        </RNView>

        <RNView style={styles.sellerHubExtra}>
          <Pressable
            style={({ pressed }) => [styles.sellerHubExtraButton, pressed && styles.buttonPressed]}
            onPress={() =>
              (router.push as (href: string) => void)("/(tabs)/store?listingType=resale")
            }
          >
            <Ionicons name="bag" size={20} color="#fff" />
            <Text style={styles.sellerHubExtraText}>Browse Resale Store</Text>
          </Pressable>
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
  const { member, subscriptionPlan, loading, refreshMember } = useAuth();
  const { profileView, hasSeller, hasSubscriber, setProfileView } = useProfileView();

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
  const [businesses, setBusinesses] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [downloadPickerType, setDownloadPickerType] = useState<"qr" | "flyer" | null>(null);
  const [downloading, setDownloading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (profileView === "business_hub") {
        apiGet<{ id: string; name: string; slug: string }[] | { error: string }>(
          "/api/businesses?mine=1"
        )
          .then((data) => {
            setBusinesses(Array.isArray(data) ? data : []);
          })
          .catch(() => setBusinesses([]));
      }
    }, [profileView])
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
    setDownloadPickerType(null);
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
    setDownloadPickerType(null);
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
    if (businesses.length === 0) {
      Alert.alert("No businesses", "Add a business first to download a QR code or flyer.");
      return;
    }
    if (businesses.length === 1) {
      type === "qr"
        ? handleDownloadQR(businesses[0].id, businesses[0].slug)
        : handleDownloadFlyer(businesses[0].id, businesses[0].slug);
      return;
    }
    setDownloadPickerType(type);
  };

  if (loading || !member) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
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
      {
        label: "Offer a Coupon",
        icon: "pricetag",
        onPress: () => setCouponModalVisible(true),
      },
      {
        label: "Offer a Reward",
        icon: "gift",
        onPress: () => setRewardModalVisible(true),
      },
      {
        label: "Post Event",
        icon: "calendar",
        onPress: () => setEventModalVisible(true),
      },
    ];

    return (
      <View style={styles.container}>
        <ScrollView
          style={styles.businessHubScroll}
          contentContainerStyle={styles.businessHubContent}
        >
          <RNView style={styles.sellerHubHero}>
            <RNView style={styles.sellerHubHeroText}>
              <Text style={styles.sellerHubTitle}>Business Hub</Text>
              <Text style={styles.sellerHubSubtitle}>
                Give residents a reason to support local. Offer Coupons, Rewards, & Post Events
              </Text>
            </RNView>
            <RNView style={styles.sellerHubPhotoWrap}>
              {member?.profilePhotoUrl ? (
                <Image
                  source={{ uri: member.profilePhotoUrl }}
                  style={styles.sellerHubPhoto}
                  resizeMode="cover"
                />
              ) : (
                <RNView style={styles.sellerHubPhotoPlaceholder}>
                  <Ionicons name="business" size={40} color={theme.colors.text} />
                </RNView>
              )}
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

          {businesses.length > 0 && (
            <RNView style={styles.businessHubDownloadSection}>
              <Text style={styles.downloadSectionTitle}>Download</Text>
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
                These QR codes can be scanned so residents get reward points for supporting your local
                business. Download the QR or print the Flyer and hang it up in your storefront.
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

        {downloadPickerType && businesses.length > 1 && (
          <Modal
            visible={!!downloadPickerType}
            transparent
            animationType="fade"
            onRequestClose={() => setDownloadPickerType(null)}
          >
            <Pressable
              style={styles.businessPickerOverlay}
              onPress={() => setDownloadPickerType(null)}
            >
              <RNView style={styles.businessPickerSheet}>
                <Text style={styles.businessPickerTitle}>
                  Select business for {downloadPickerType === "qr" ? "QR Code" : "Flyer"}
                </Text>
                {businesses.map((b) => (
                  <Pressable
                    key={b.id}
                    style={({ pressed }) => [styles.businessPickerOption, pressed && styles.buttonPressed]}
                    onPress={() => {
                      if (downloadPickerType === "qr") {
                        handleDownloadQR(b.id, b.slug);
                      } else {
                        handleDownloadFlyer(b.id, b.slug);
                      }
                      setDownloadPickerType(null);
                    }}
                  >
                    <Text style={styles.businessPickerOptionText}>{b.name}</Text>
                  </Pressable>
                ))}
                <Pressable
                  style={({ pressed }) => [styles.businessPickerCancel, pressed && styles.buttonPressed]}
                  onPress={() => setDownloadPickerType(null)}
                >
                  <Text style={styles.businessPickerCancelText}>Cancel</Text>
                </Pressable>
              </RNView>
            </Pressable>
          </Modal>
        )}

        <CouponFormModal
          visible={couponModalVisible}
          onClose={() => setCouponModalVisible(false)}
          onSuccess={() => setCouponModalVisible(false)}
          onOpenBusinessSetup={openBusinessSetup}
        />
        <RewardFormModal
          visible={rewardModalVisible}
          onClose={() => setRewardModalVisible(false)}
          onSuccess={() => setRewardModalVisible(false)}
          onOpenBusinessSetup={openBusinessSetup}
        />
        <Modal
          visible={eventModalVisible}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setEventModalVisible(false)}
        >
          <View style={styles.eventModalContainer}>
            <View style={styles.eventModalHeader}>
              <Pressable
                style={({ pressed }) => [
                  styles.eventModalCancelBtn,
                  pressed && styles.buttonPressed,
                ]}
                onPress={() => setEventModalVisible(false)}
              >
                <Text style={styles.eventModalCancelText}>Cancel</Text>
              </Pressable>
              <Text style={styles.eventModalTitle}>Post Event</Text>
              <View style={styles.eventModalSpacer} />
            </View>
            <PostEventForm
              onSuccess={() => setEventModalVisible(false)}
            />
          </View>
        </Modal>
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
        </View>

        <View style={styles.pointsRow}>
          <View style={styles.smallBox}>
            <ThemedText style={styles.smallBoxText} numberOfLines={1}>
              {member.points ?? 0} points
            </ThemedText>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.postsBox, pressed && { opacity: 0.9 }]}
          onPress={() => (router.push as (href: string) => void)("/(tabs)/index")}
        >
          <ThemedText style={styles.postsBoxText}>Posts + Photos</ThemedText>
          <Ionicons name="chevron-forward" size={20} color="#000" />
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.editProfileButton, pressed && styles.buttonPressed]}
          onPress={() => router.push("/profile-edit")}
        >
          <ThemedText style={styles.editProfileButtonText}>Edit Profile</ThemedText>
        </Pressable>
      </View>

      <RNView style={styles.tanSection}>
        <RNView style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() =>
              router.push(
                `/web?url=${encodeURIComponent(`${siteBase}/my-community/friends`)}&title=${encodeURIComponent("My Friends")}`
              )
            }
          >
            <ThemedText style={styles.tanButtonText}>My Friends</ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/profile-businesses")}
          >
            <ThemedText style={styles.tanButtonText}>My Businesses</ThemedText>
          </Pressable>
        </RNView>
        <RNView style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/profile-events")}
          >
            <ThemedText style={styles.tanButtonText}>My Events</ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/profile-coupons")}
          >
            <ThemedText style={styles.tanButtonText}>My Coupons</ThemedText>
          </Pressable>
        </RNView>
        <RNView style={styles.buttonRow}>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() => router.push("/profile-wishlist")}
          >
            <ThemedText style={styles.tanButtonText}>My Wishlist</ThemedText>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tanButton, pressed && styles.buttonPressed]}
            onPress={() =>
              router.push(
                `/web?url=${encodeURIComponent(`${siteBase}/my-community/orders`)}&title=${encodeURIComponent("My Orders")}`
              )
            }
          >
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
  container: {
    flex: 1,
    backgroundColor: "#ffffff",
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
    marginBottom: 24,
  },
  postsBoxText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#000",
  },
  editProfileButton: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: "center",
    borderRadius: 4,
    alignSelf: "flex-start",
    marginTop: 24,
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
  tanButton: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 6,
    padding: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tanButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    textAlign: "center",
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
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  eventModalCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  eventModalCancelText: {
    fontSize: 16,
    color: theme.colors.primary,
  },
  eventModalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
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
  sellerHubPhotoWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
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
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  sellerHubGridLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    textAlign: "center",
  },
  sellerHubExtra: {
    marginTop: 16,
  },
  sellerHubExtraButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  sellerHubExtraText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
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
