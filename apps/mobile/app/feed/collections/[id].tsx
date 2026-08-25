import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
import { AppImage } from "@/components/AppImage";
import { buildProductPath } from "@/lib/product-referrer";

type CollectionItem = {
  id: string;
  title: string;
  slug: string;
  photos: string[];
  priceCents: number;
  status: string;
  quantity: number;
};

export default function ListingFeedCollectionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState<string | null>(null);
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    apiGet<{ title?: string; items?: CollectionItem[]; error?: string }>(
      `/api/feed/listing-collections/${encodeURIComponent(id)}`
    )
      .then((data) => {
        if (cancelled) return;
        setTitle(data.title ?? "New Listings");
        setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch((e: { error?: string }) => {
        if (cancelled) return;
        setError(e?.error ?? "Could not load this collection.");
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: title ?? "Collection",
          headerBackTitle: "Feed",
        }}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: 24 + insets.bottom }]}
      >
        {items === null ? (
          <ActivityIndicator color={theme.colors.primary} style={{ marginTop: 24 }} />
        ) : (
          <>
            <Text style={styles.title}>{title ?? "Collection"}</Text>
            <Text style={styles.subtitle}>
              New listings from this share. Open any item to view or buy it.
            </Text>
            {error ? (
              <Text style={styles.error}>{error}</Text>
            ) : items.length === 0 ? (
              <Text style={styles.subtitle}>These listings are no longer available.</Text>
            ) : (
          items.map((item) => {
            const sold = item.status !== "active" || item.quantity <= 0;
            return (
              <Pressable
                key={item.id}
                style={styles.card}
                onPress={() =>
                  (router.push as (href: string) => void)(
                    buildProductPath(item.slug, {
                      type: "feed-collection",
                      collectionId: String(id),
                    })
                  )
                }
              >
                {item.photos[0] ? (
                  <AppImage
                    uri={item.photos[0]}
                    targetWidth={88}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]} />
                )}
                <View style={styles.cardBody}>
                  <Text style={styles.itemTitle} numberOfLines={2}>
                    {item.title}
                  </Text>
                  <Text style={styles.price}>
                    ${(item.priceCents / 100).toFixed(2)}
                    {sold ? " · Sold" : ""}
                  </Text>
                </View>
              </Pressable>
            );
          })
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.cream },
  content: { padding: 16 },
  title: {
    fontSize: 24,
    fontWeight: "700",
    fontFamily: theme.fonts.heading,
    color: theme.colors.heading,
    marginBottom: 8,
  },
  subtitle: { fontSize: 14, color: theme.colors.text, marginBottom: 16, lineHeight: 20 },
  error: { fontSize: 14, color: theme.colors.heading, marginTop: 8 },
  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    padding: 12,
    marginBottom: 12,
  },
  thumb: { width: 88, height: 88, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: theme.colors.cream },
  cardBody: { flex: 1, minWidth: 0, justifyContent: "center" },
  itemTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  price: { fontSize: 14, color: theme.colors.text, marginTop: 6 },
});
