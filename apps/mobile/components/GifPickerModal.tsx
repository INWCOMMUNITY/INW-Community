import { useEffect, useState, useCallback } from "react";
import {
  Modal,
  StyleSheet,
  View,
  Text,
  Pressable,
  FlatList,
  Image,
  ActivityIndicator,
  TextInput,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet } from "@/lib/api";
const { width } = Dimensions.get("window");
const COLS = 3;
const GAP = 6;
const GIF_SIZE = (width - 32 - GAP * (COLS - 1)) / COLS;

interface GiphyGif {
  id: string;
  images: {
    fixed_height?: { url: string };
    downsized?: { url: string };
    original?: { url: string };
  };
}

interface GifPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (gifUrl: string) => void;
}

async function fetchTrending(): Promise<GiphyGif[]> {
  const data = await apiGet<{ data?: GiphyGif[]; error?: string }>(
    "/api/giphy/trending?limit=24"
  );
  if ((data as { error?: string }).error) throw new Error((data as { error?: string }).error);
  return (data as { data?: GiphyGif[] }).data ?? [];
}

async function fetchSearch(q: string, offset = 0): Promise<GiphyGif[]> {
  if (!q.trim()) return [];
  const data = await apiGet<{ data?: GiphyGif[]; error?: string }>(
    `/api/giphy/search?q=${encodeURIComponent(q)}&limit=24&offset=${offset}`
  );
  if ((data as { error?: string }).error) throw new Error((data as { error?: string }).error);
  return (data as { data?: GiphyGif[] }).data ?? [];
}

function getGifUrl(g: GiphyGif): string {
  return (
    g.images?.fixed_height?.url ??
    g.images?.downsized?.url ??
    g.images?.original?.url ??
    ""
  );
}

export function GifPickerModal({
  visible,
  onClose,
  onSelect,
}: GifPickerModalProps) {
  const [gifs, setGifs] = useState<GiphyGif[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadGifs = useCallback(async (query?: string, skip = 0, append = false) => {
    if (!append) setLoading(true);
    else setLoadingMore(true);
    setError(null);
    try {
      const data = query?.trim()
        ? await fetchSearch(query, skip)
        : await fetchTrending();
      setGifs((prev) => (append ? [...prev, ...data] : data));
      setOffset(skip + data.length);
    } catch (e) {
      setError((e as Error).message ?? "Could not load GIFs");
      if (!append) setGifs([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setSearch("");
    setSearchQuery("");
    setOffset(0);
    setError(null);
    loadGifs();
  }, [visible]);

  const handleSearch = () => {
    setSearchQuery(search);
    loadGifs(search, 0, false);
  };

  const loadMore = () => {
    if (loadingMore || !gifs.length) return;
    loadGifs(searchQuery || undefined, offset, true);
  };

  const handleSelect = (g: GiphyGif) => {
    const url = getGifUrl(g);
    if (url) {
      onSelect(url);
      onClose();
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Choose a GIF</Text>
            <Pressable onPress={onClose} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}>
              <Ionicons name="close" size={24} color={theme.colors.heading} />
            </Pressable>
          </View>
          <>
            <View style={styles.searchRow}>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search GIFs…"
                  placeholderTextColor={theme.colors.placeholder}
                  value={search}
                  onChangeText={setSearch}
                  onSubmitEditing={handleSearch}
                  returnKeyType="search"
                />
                <Pressable
                  onPress={handleSearch}
                  style={({ pressed }) => [styles.searchBtn, pressed && { opacity: 0.8 }]}
                >
                  <Ionicons name="search" size={22} color="#fff" />
                </Pressable>
              </View>
              {error ? (
                <View style={styles.errorWrap}>
                  <Text style={styles.errorText}>{error}</Text>
                  <Text style={styles.errorHint}>Make sure the main server is running (pnpm dev:main)</Text>
                </View>
              ) : loading && !loadingMore ? (
                <View style={styles.loading}>
                  <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
              ) : (
                <FlatList
                  data={gifs}
                  keyExtractor={(item, index) => `${item.id}-${index}`}
                  numColumns={COLS}
                  columnWrapperStyle={styles.row}
                  renderItem={({ item }) => {
                    const url = getGifUrl(item);
                    if (!url) return null;
                    return (
                      <Pressable
                        style={styles.gifCell}
                        onPress={() => handleSelect(item)}
                      >
                        <Image
                          source={{ uri: url }}
                          style={styles.gifImage}
                          resizeMode="cover"
                        />
                      </Pressable>
                    );
                  }}
                  onEndReached={loadMore}
                  onEndReachedThreshold={0.5}
                  ListFooterComponent={
                    loadingMore ? (
                      <View style={styles.footer}>
                        <ActivityIndicator size="small" color={theme.colors.primary} />
                      </View>
                    ) : null
                  }
                  ListEmptyComponent={
                    !loading ? (
                      <Text style={styles.empty}>No GIFs found. Try a different search.</Text>
                    ) : null
                  }
                />
              )}
          </>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: "70%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: theme.colors.heading,
  },
  closeBtn: { padding: 4 },
  noKey: {
    padding: 24,
    fontSize: 14,
    color: theme.colors.placeholder,
  },
  searchRow: {
    flexDirection: "row",
    gap: 8,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  searchInput: {
    flex: 1,
    height: 40,
    paddingHorizontal: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    fontSize: 15,
    color: theme.colors.heading,
  },
  searchBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  loading: { padding: 48, alignItems: "center" },
  errorWrap: { padding: 24, alignItems: "center" },
  errorText: { fontSize: 15, color: "#c00", textAlign: "center" },
  errorHint: { fontSize: 13, color: "#666", marginTop: 8, textAlign: "center" },
  row: { gap: GAP, marginBottom: GAP, paddingHorizontal: 16 },
  gifCell: {
    width: GIF_SIZE,
    height: GIF_SIZE,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#eee",
  },
  gifImage: {
    width: "100%",
    height: "100%",
  },
  footer: { padding: 16, alignItems: "center" },
  empty: {
    padding: 24,
    textAlign: "center",
    fontSize: 14,
    color: theme.colors.placeholder,
  },
});
