import React, { useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Pressable,
  FlatList,
  type ViewToken,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

type Slide = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  highlight?: string;
};

const SLIDES: Slide[] = [
  {
    id: "welcome",
    icon: "sync-circle-outline",
    title: "Sync Your Storefronts",
    description:
      "Connect eBay, Etsy, Shopify, and Wix to manage all your listings from one place. INW Community becomes your central hub for multi-platform selling.",
    highlight: "One inventory, multiple platforms",
  },
  {
    id: "inventory",
    icon: "layers-outline",
    title: "Unified Inventory",
    description:
      "When you sell an item on any platform, INW automatically updates the quantity everywhere. No more manual updates, no more overselling.",
    highlight: "Sell anywhere, updates everywhere",
  },
  {
    id: "bidirectional",
    icon: "swap-horizontal-outline",
    title: "Two-Way Sync",
    description:
      "Changes sync in both directions. Edit a price on eBay? It updates on INW and your other stores. Update on INW? It pushes to all connected platforms.",
    highlight: "Edit once, sync everywhere",
  },
  {
    id: "conflicts",
    icon: "shield-checkmark-outline",
    title: "Smart Conflict Resolution",
    description:
      "If the same item changes on multiple platforms, INW uses timestamps to pick the most recent version. You can also set INW as the source of truth.",
    highlight: "Most recent edit wins",
  },
  {
    id: "safety",
    icon: "settings-outline",
    title: "Safety Controls",
    description:
      "Set a safety buffer to hold back inventory, pause sync when needed, or choose which fields to sync. You're always in control.",
    highlight: "Pause, buffer, and customize",
  },
];

const STORAGE_KEY = "sync_onboarding_dismissed";

type Props = {
  onDismiss?: () => void;
};

export function SyncOnboarding({ onDismiss }: Props) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const flatListRef = useRef<FlatList>(null);

  // Check if onboarding was previously dismissed
  React.useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val === "true") setDismissed(true);
    });
  }, []);

  const handleDismiss = async () => {
    await AsyncStorage.setItem(STORAGE_KEY, "true");
    setDismissed(true);
    onDismiss?.();
  };

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  if (dismissed) return null;

  const isLastSlide = currentIndex === SLIDES.length - 1;

  const handleNext = () => {
    if (isLastSlide) {
      handleDismiss();
    } else {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
    }
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View style={styles.slide}>
      <View style={styles.iconContainer}>
        <Ionicons name={item.icon} size={56} color={theme.colors.primary} />
      </View>
      <Text style={styles.slideTitle}>{item.title}</Text>
      <Text style={styles.slideDescription}>{item.description}</Text>
      {item.highlight && (
        <View style={styles.highlightContainer}>
          <Ionicons name="checkmark-circle" size={18} color="#2e7d32" />
          <Text style={styles.highlightText}>{item.highlight}</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>How Sync Works</Text>
        <Pressable onPress={handleDismiss} hitSlop={12}>
          <Ionicons name="close" size={24} color="#6b7280" />
        </Pressable>
      </View>

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH - 32,
          offset: (SCREEN_WIDTH - 32) * index,
          index,
        })}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, idx) => (
            <View
              key={idx}
              style={[styles.dot, idx === currentIndex && styles.dotActive]}
            />
          ))}
        </View>

        <Pressable
          style={({ pressed }) => [
            styles.nextButton,
            pressed && styles.nextButtonPressed,
          ]}
          onPress={handleNext}
        >
          <Text style={styles.nextButtonText}>
            {isLastSlide ? "Got it!" : "Next"}
          </Text>
          {!isLastSlide && (
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          )}
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Reset the onboarding dismissed state (for testing or "Show tutorial again" button).
 */
export async function resetSyncOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

/**
 * Check if onboarding has been dismissed.
 */
export async function isSyncOnboardingDismissed(): Promise<boolean> {
  const val = await AsyncStorage.getItem(STORAGE_KEY);
  return val === "true";
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginHorizontal: 16,
    marginVertical: 12,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#fafafa",
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  slide: {
    width: SCREEN_WIDTH - 64,
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: "center",
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#f0f9ff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  slideTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: theme.colors.heading,
    textAlign: "center",
    marginBottom: 12,
  },
  slideDescription: {
    fontSize: 15,
    color: "#666",
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  highlightContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#e8f5e9",
    borderRadius: 20,
  },
  highlightText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2e7d32",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#f0f0f0",
  },
  dots: {
    flexDirection: "row",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#e0e0e0",
  },
  dotActive: {
    backgroundColor: theme.colors.primary,
    width: 20,
  },
  nextButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  nextButtonPressed: {
    opacity: 0.85,
  },
  nextButtonText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 15,
  },
});
