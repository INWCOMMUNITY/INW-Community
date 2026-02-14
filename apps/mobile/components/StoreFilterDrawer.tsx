/**
 * Storefront filters & browse-by side drawer.
 * Matches the website StorefrontGallery sidebar options.
 */
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);
const NAV_HEADER_HEIGHT = 56;

export type DeliveryFilter = "" | "local" | "shipping";

interface StoreFilterDrawerProps {
  visible: boolean;
  onClose: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  categories: string[];
  sizes: string[];
  category: string;
  size: string;
  deliveryFilter: DeliveryFilter;
  onCategoryChange: (category: string) => void;
  onSizeChange: (size: string) => void;
  onDeliveryFilterChange: (filter: DeliveryFilter) => void;
  listingType: "new" | "resale";
}

export function StoreFilterDrawer({
  visible,
  onClose,
  search,
  onSearchChange,
  categories,
  sizes,
  category,
  size,
  deliveryFilter,
  onCategoryChange,
  onSizeChange,
  onDeliveryFilterChange,
  listingType,
}: StoreFilterDrawerProps) {
  const insets = useSafeAreaInsets();
  const drawerTop = insets.top + NAV_HEADER_HEIGHT;
  const title =
    listingType === "new" ? "Storefront Filters" : "Resale Filters";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.drawer, { top: drawerTop }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{title}</Text>
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            hitSlop={12}
          >
            <Ionicons name="close" size={28} color={theme.colors.heading} />
          </Pressable>
        </View>

        <TextInput
          style={styles.searchBar}
          placeholder={listingType === "new" ? "Search storefront..." : "Search resale..."}
          placeholderTextColor={theme.colors.placeholder}
          value={search}
          onChangeText={onSearchChange}
        />

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Browse by */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Browse by</Text>
            <View style={styles.divider} />
            <Pressable
              onPress={() => onCategoryChange("")}
              style={({ pressed }) => [
                styles.optionRow,
                category === "" && styles.optionRowActive,
                pressed && { opacity: 0.8 },
              ]}
            >
              <Text
                style={[
                  styles.optionText,
                  category === "" && styles.optionTextActive,
                ]}
              >
                All Products
              </Text>
            </Pressable>
            {categories.map((c) => (
              <Pressable
                key={c}
                onPress={() => onCategoryChange(c)}
                style={({ pressed }) => [
                  styles.optionRow,
                  category === c && styles.optionRowActive,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text
                  style={[
                    styles.optionText,
                    category === c && styles.optionTextActive,
                  ]}
                >
                  {c}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Filter by */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Filter by</Text>
            <View style={styles.divider} />

            {/* Size */}
            <Text style={styles.filterLabel}>Size</Text>
            {sizes.length === 0 ? (
              <Text style={styles.filterHint}>No sizes yet.</Text>
            ) : (
              <View style={styles.sizeRow}>
                {sizes.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => onSizeChange(size === s ? "" : s)}
                    style={({ pressed }) => [
                      styles.sizeChip,
                      size === s && styles.sizeChipActive,
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sizeChipText,
                        size === s && styles.sizeChipTextActive,
                      ]}
                    >
                      {s}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Delivery */}
            <Text style={[styles.filterLabel, { marginTop: 12 }]}>Delivery</Text>
            <View style={styles.radioGroup}>
              <Pressable
                onPress={() => onDeliveryFilterChange("")}
                style={({ pressed }) => [
                  styles.radioRow,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View
                  style={[
                    styles.radioOuter,
                    deliveryFilter === "" && styles.radioOuterActive,
                  ]}
                >
                  {deliveryFilter === "" && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.radioLabel}>All</Text>
              </Pressable>
              <Pressable
                onPress={() => onDeliveryFilterChange("local")}
                style={({ pressed }) => [
                  styles.radioRow,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View
                  style={[
                    styles.radioOuter,
                    deliveryFilter === "local" && styles.radioOuterActive,
                  ]}
                >
                  {deliveryFilter === "local" && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.radioLabel}>Local Delivery</Text>
              </Pressable>
              <Pressable
                onPress={() => onDeliveryFilterChange("shipping")}
                style={({ pressed }) => [
                  styles.radioRow,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View
                  style={[
                    styles.radioOuter,
                    deliveryFilter === "shipping" && styles.radioOuterActive,
                  ]}
                >
                  {deliveryFilter === "shipping" && (
                    <View style={styles.radioInner} />
                  )}
                </View>
                <Text style={styles.radioLabel}>Shipping only</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  drawer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: "#fff",
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.primary,
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
  searchBar: {
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: theme.colors.cream,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#000",
    marginHorizontal: 16,
    marginVertical: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: "#e0e0e0",
    marginBottom: 12,
  },
  optionRow: {
    paddingVertical: 10,
  },
  optionRowActive: {},
  optionText: {
    fontSize: 15,
    color: "#444",
  },
  optionTextActive: {
    color: theme.colors.primary,
    fontWeight: "600",
  },
  filterLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.heading,
    marginBottom: 8,
  },
  filterHint: {
    fontSize: 14,
    color: "#888",
    marginBottom: 4,
  },
  sizeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  sizeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  sizeChipActive: {
    backgroundColor: theme.colors.primary,
  },
  sizeChipText: {
    fontSize: 14,
    color: theme.colors.primary,
  },
  sizeChipTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  radioGroup: {
    gap: 4,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 10,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#999",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOuterActive: {
    borderColor: theme.colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
  },
  radioLabel: {
    fontSize: 15,
    color: "#444",
  },
});
