import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";

interface CategorySuggestion {
  categoryId: string | number;
  categoryPath: string;
  confidence: number;
}

interface InwSuggestion {
  category: string;
  subcategory: string | null;
  confidence: number;
}

interface CategorySuggestionsProps {
  title: string;
  category?: string;
  subcategory?: string | null;
  onSelectInwCategory?: (category: string, subcategory: string | null) => void;
  onSelectEbayCategory?: (categoryId: string, categoryPath: string) => void;
  ebayConnected?: boolean;
  showInwSuggestion?: boolean;
}

export function CategorySuggestions({
  title,
  category,
  subcategory,
  onSelectInwCategory,
  onSelectEbayCategory,
  ebayConnected = false,
  showInwSuggestion = true,
}: CategorySuggestionsProps) {
  const [loading, setLoading] = useState(false);
  const [inwSuggestion, setInwSuggestion] = useState<InwSuggestion | null>(null);
  const [ebaySuggestions, setEbaySuggestions] = useState<CategorySuggestion[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [lastTitle, setLastTitle] = useState("");

  const fetchSuggestions = useCallback(async () => {
    if (!title.trim() || title.length < 3) {
      setInwSuggestion(null);
      setEbaySuggestions([]);
      return;
    }

    if (title === lastTitle) return;
    setLastTitle(title);

    setLoading(true);
    try {
      const params = new URLSearchParams({
        title,
        suggestInw: showInwSuggestion && !category ? "true" : "false",
        ...(category && { category }),
        ...(subcategory && { subcategory }),
        ...(ebayConnected && { providers: "ebay" }),
      });

      const data = await apiGet<{
        inwSuggestion?: InwSuggestion;
        suggestions?: { ebay?: CategorySuggestion[] };
      }>(`/api/channels/suggest-categories?${params.toString()}`);

      if (data.inwSuggestion && data.inwSuggestion.confidence > 0.4) {
        setInwSuggestion(data.inwSuggestion);
      } else {
        setInwSuggestion(null);
      }

      if (data.suggestions?.ebay) {
        setEbaySuggestions(data.suggestions.ebay.slice(0, 3));
      } else {
        setEbaySuggestions([]);
      }
    } catch {
      setInwSuggestion(null);
      setEbaySuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [title, category, subcategory, ebayConnected, showInwSuggestion, lastTitle]);

  useEffect(() => {
    const timer = setTimeout(fetchSuggestions, 500);
    return () => clearTimeout(timer);
  }, [fetchSuggestions]);

  useEffect(() => {
    setDismissed(false);
  }, [title]);

  if (dismissed) return null;

  const hasContent =
    (showInwSuggestion && inwSuggestion && !category) ||
    (ebayConnected && ebaySuggestions.length > 0);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Finding categories...</Text>
        </View>
      </View>
    );
  }

  if (!hasContent) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Suggested Categories</Text>
        <Pressable onPress={() => setDismissed(true)}>
          <Text style={styles.dismiss}>Dismiss</Text>
        </Pressable>
      </View>

      {showInwSuggestion && inwSuggestion && !category && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>INW Category</Text>
          <Pressable
            style={({ pressed }) => [styles.suggestionChip, pressed && { opacity: 0.7 }]}
            onPress={() => {
              onSelectInwCategory?.(inwSuggestion.category, inwSuggestion.subcategory);
              setInwSuggestion(null);
            }}
          >
            <Text style={styles.suggestionText}>
              {inwSuggestion.category}
              {inwSuggestion.subcategory ? ` > ${inwSuggestion.subcategory}` : ""}
            </Text>
            <Text style={styles.selectText}>Select</Text>
          </Pressable>
        </View>
      )}

      {ebayConnected && ebaySuggestions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>eBay Categories</Text>
          {ebaySuggestions.map((suggestion, index) => (
            <Pressable
              key={`${suggestion.categoryId}-${index}`}
              style={({ pressed }) => [styles.suggestionChip, pressed && { opacity: 0.7 }]}
              onPress={() => {
                onSelectEbayCategory?.(String(suggestion.categoryId), suggestion.categoryPath);
              }}
            >
              <View style={styles.suggestionContent}>
                <Text style={styles.suggestionText} numberOfLines={2}>
                  {suggestion.categoryPath}
                </Text>
                <Text style={styles.suggestionId}>#{suggestion.categoryId}</Text>
              </View>
              <Text style={styles.selectText}>Select</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#f8f9fa",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e9ecef",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  dismiss: {
    fontSize: 13,
    color: "#666",
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 13,
    color: "#666",
  },
  section: {
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 12,
    color: "#666",
    marginBottom: 6,
    fontWeight: "500",
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  suggestionContent: {
    flex: 1,
    marginRight: 8,
  },
  suggestionText: {
    fontSize: 14,
    color: "#333",
  },
  suggestionId: {
    fontSize: 11,
    color: "#999",
    marginTop: 2,
  },
  selectText: {
    fontSize: 13,
    color: theme.colors.primary,
    fontWeight: "600",
  },
});
