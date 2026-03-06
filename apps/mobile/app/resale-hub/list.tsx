import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { theme } from "@/lib/theme";

/**
 * Redirect to Seller Hub "List an Item" with resale context.
 * Preserves edit param for /resale-hub/list?edit=id.
 */
export default function ResaleHubListRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams<{ edit?: string }>();
  const editId = params.edit?.trim() || undefined;

  useEffect(() => {
    const search = new URLSearchParams({ listingType: "resale" });
    if (editId) search.set("edit", editId);
    router.replace(`/seller-hub/store/new?${search.toString()}` as never);
  }, [router, editId]);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
});
