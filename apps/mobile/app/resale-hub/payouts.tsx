import React from "react";
import { StyleSheet, View, Text } from "react-native";
import { theme } from "@/lib/theme";

export default function ResaleHubPayoutsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>My Payouts</Text>
      <Text style={styles.intro}>
        When you sell items on Community Resale, earnings are added to your balance. Set up payouts
        to receive your funds.
      </Text>
      <Text style={styles.placeholder}>
        Payout setup and balance will be available here once you have made a sale or connected your
        account.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", padding: 20 },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: theme.colors.heading,
    marginBottom: 16,
  },
  intro: {
    fontSize: 16,
    color: "#666",
    marginBottom: 16,
    lineHeight: 24,
  },
  placeholder: {
    fontSize: 14,
    color: "#888",
    lineHeight: 22,
  },
});
