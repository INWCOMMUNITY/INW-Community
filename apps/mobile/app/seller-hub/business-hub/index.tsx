import React, { useEffect, useState } from "react";
import { Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { theme } from "@/lib/theme";
import { CouponFormModal } from "@/components/CouponFormModal";
import { RewardFormModal } from "@/components/RewardFormModal";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

export default function BusinessHubScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ open?: string }>();
  const [couponModalVisible, setCouponModalVisible] = useState(false);
  const [rewardModalVisible, setRewardModalVisible] = useState(false);

  const openBusinessSetup = () => {
    (router.push as (href: string) => void)("/sponsor-business");
  };

  useEffect(() => {
    const open = params.open;
    if (open === "coupon") setCouponModalVisible(true);
    else if (open === "reward") setRewardModalVisible(true);
  }, [params.open]);

  const closeCouponModal = () => {
    setCouponModalVisible(false);
    if (params.open === "coupon") {
      router.replace("/seller-hub/business-hub");
    }
  };

  const closeRewardModal = () => {
    setRewardModalVisible(false);
    if (params.open === "reward") {
      router.replace("/seller-hub/business-hub");
    }
  };

  const OPTIONS = [
    { label: "Business profile", href: "/sponsor-business" },
    { label: "Offer a coupon", action: "coupon" as const },
    { label: "Post event", web: `${siteBase}/business-hub/event` },
    { label: "Offer a reward", action: "reward" as const },
  ];

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Business Hub</Text>
        <Text style={styles.hint}>
          Business directory, coupons, events, and rewards.
        </Text>
        {OPTIONS.map((opt) => (
          <Pressable
            key={opt.label}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
            onPress={() => {
              if ("href" in opt && opt.href) {
                (router.push as (href: string) => void)(opt.href);
              } else if ("action" in opt && opt.action) {
                if (opt.action === "coupon") setCouponModalVisible(true);
                else if (opt.action === "reward") setRewardModalVisible(true);
              } else if ("web" in opt && opt.web) {
                (router.push as (href: string) => void)(
                  `/web?url=${encodeURIComponent(opt.web)}&title=${encodeURIComponent(opt.label)}`
                );
              }
            }}
          >
            <Text style={styles.cardText}>{opt.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <CouponFormModal
        visible={couponModalVisible}
        onClose={closeCouponModal}
        onSuccess={closeCouponModal}
        onOpenBusinessSetup={openBusinessSetup}
      />
      <RewardFormModal
        visible={rewardModalVisible}
        onClose={closeRewardModal}
        onSuccess={closeRewardModal}
        onOpenBusinessSetup={openBusinessSetup}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  hint: { fontSize: 14, color: "#666", marginBottom: 24 },
  card: {
    backgroundColor: theme.colors.creamAlt,
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.colors.cream,
  },
  cardText: { fontSize: 16, fontWeight: "600", color: theme.colors.primary },
});
