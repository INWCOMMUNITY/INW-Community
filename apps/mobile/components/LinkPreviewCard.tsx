import { useState, useEffect } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Linking,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppImage } from "@/components/AppImage";
import { theme } from "@/lib/theme";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";

interface OGData {
  title?: string;
  description?: string;
  image?: string;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkPreviewCard({
  url,
  embedded = false,
}: {
  url: string;
  embedded?: boolean;
}) {
  const [og, setOg] = useState<OGData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`${API_BASE}/api/og-preview?url=${encodeURIComponent(url)}`)
      .then((res) => res.json())
      .then((data: OGData) => {
        if (!cancelled) setOg(data?.title || data?.description || data?.image ? data : null);
      })
      .catch(() => {
        if (!cancelled) setOg(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const domain = extractDomain(url);

  const handlePress = () => {
    Linking.openURL(url).catch(() => {});
  };

  if (loading) {
    return (
      <View style={[styles.card, embedded && styles.cardEmbedded]}>
        <View style={styles.loadingRow}>
          <Ionicons name="link-outline" size={16} color="#999" />
          <Text style={styles.domainText} numberOfLines={1}>
            {domain}
          </Text>
        </View>
      </View>
    );
  }

  if (!og) {
    return (
      <Pressable style={[styles.card, embedded && styles.cardEmbedded]} onPress={handlePress}>
        <View style={styles.simpleRow}>
          <Ionicons name="link-outline" size={16} color={theme.colors.primary} />
          <Text style={styles.simpleLinkText} numberOfLines={1}>
            {domain}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable style={[styles.card, embedded && styles.cardEmbedded]} onPress={handlePress}>
      {og.image && (
        <AppImage
          uri={og.image}
          targetWidth={400}
          style={styles.image}
          resizeMode="cover"
        />
      )}
      <View style={styles.content}>
        {og.title && (
          <Text style={styles.title} numberOfLines={2}>
            {og.title}
          </Text>
        )}
        {og.description && (
          <Text style={styles.description} numberOfLines={3}>
            {og.description}
          </Text>
        )}
        <Text style={styles.domainText} numberOfLines={1}>
          {domain}
        </Text>
      </View>
    </Pressable>
  );
}

export function CollapsibleLinkPreview({
  url,
  style,
}: {
  url: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [expanded, setExpanded] = useState(false);
  const domain = extractDomain(url);

  return (
    <View style={style}>
      <Pressable
        style={styles.collapsibleHeader}
        onPress={() => setExpanded((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={expanded ? `Hide link preview for ${domain}` : `Show link preview for ${domain}`}
      >
        <Ionicons name="link-outline" size={16} color={theme.colors.primary} />
        <Text style={styles.collapsibleLabel} numberOfLines={1}>
          {domain}
        </Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color="#666" />
      </Pressable>
      {expanded ? <LinkPreviewCard url={url} embedded /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: "#fafafa",
    marginVertical: 6,
  },
  cardEmbedded: {
    marginVertical: 0,
    marginTop: 8,
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#e0e0e0",
    borderRadius: 8,
    backgroundColor: "#fafafa",
  },
  collapsibleLabel: {
    flex: 1,
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "500",
  },
  image: {
    width: "100%",
    height: 160,
  },
  content: {
    padding: 10,
    gap: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  description: {
    fontSize: 13,
    color: "#555",
    lineHeight: 18,
  },
  domainText: {
    fontSize: 12,
    color: "#888",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
  },
  simpleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
  },
  simpleLinkText: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: "500",
    flex: 1,
  },
});
