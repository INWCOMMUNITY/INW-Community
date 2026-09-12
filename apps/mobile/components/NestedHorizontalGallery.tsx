import { useCallback } from "react";
import { Platform, StyleSheet, type ImageStyle, type StyleProp } from "react-native";
import { FlatList, TouchableOpacity } from "react-native-gesture-handler";
import { AppImage } from "@/components/AppImage";

type Props = {
  urls: string[];
  onPressIndex: (index: number) => void;
  itemWidth: number;
  itemHeight: number;
  itemStyle?: StyleProp<ImageStyle>;
  contentPadding?: number;
  itemGap?: number;
};

/**
 * Horizontal photo strip meant to live inside a vertical GH FlatList/ScrollView.
 * Uses RNGH list + touchables so a slightly diagonal drag still pages photos
 * instead of being eaten by the parent scroller (or by RN Pressable).
 */
export function NestedHorizontalGallery({
  urls,
  onPressIndex,
  itemWidth,
  itemHeight,
  itemStyle,
  contentPadding = 16,
  itemGap = 10,
}: Props) {
  const renderItem = useCallback(
    ({ item, index }: { item: string; index: number }) => (
      <TouchableOpacity
        activeOpacity={0.92}
        onPress={() => onPressIndex(index)}
        accessibilityRole="button"
        accessibilityLabel={`Photo ${index + 1} of ${urls.length}`}
        style={{ marginRight: index === urls.length - 1 ? 0 : itemGap }}
      >
        <AppImage
          uri={item}
          targetWidth={itemWidth}
          style={[
            {
              width: itemWidth,
              height: itemHeight,
              borderRadius: 8,
              backgroundColor: "#f5f5f5",
            },
            itemStyle,
          ]}
          resizeMode="cover"
          recyclingKey={item}
          pointerEvents="none"
        />
      </TouchableOpacity>
    ),
    [itemGap, itemHeight, itemStyle, itemWidth, onPressIndex, urls.length]
  );

  return (
    <FlatList
      horizontal
      data={urls}
      keyExtractor={(uri, i) => `${i}-${uri}`}
      renderItem={renderItem}
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={[styles.list, { height: itemHeight }]}
      contentContainerStyle={[styles.content, { paddingHorizontal: contentPadding }]}
      overScrollMode={Platform.OS === "android" ? "never" : undefined}
      bounces
      alwaysBounceHorizontal={urls.length > 1}
      decelerationRate="fast"
      windowSize={5}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      removeClippedSubviews={false}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    marginHorizontal: -16,
    flexGrow: 0,
  },
  content: {
    alignItems: "center",
  },
});
