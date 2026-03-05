import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  description: string | null;
  createdAt: string;
}

interface FundsData {
  balanceCents: number;
  totalEarnedCents: number;
  totalPaidOutCents: number;
  transactions: Transaction[];
  hasStripeConnect: boolean;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ResaleHubPayoutsScreen() {
  const router = useRouter();
  const [data, setData] = useState<FundsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiGet<FundsData | { error: string }>("/api/seller-funds")
      .then((d) => {
        if ("error" in d) setError(d.error);
        else setData(d);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleSetup = async () => {
    try {
      const res = await apiPost<{ url?: string }>("/api/stripe/connect/onboard", {
        returnBaseUrl: siteBase,
      });
      if (res?.url) {
        const webUrl =
          `/web?url=${encodeURIComponent(res.url)}&title=Payment setup` +
          `&successPattern=${encodeURIComponent("seller-hub/store")}` +
          `&successRoute=${encodeURIComponent("/resale-hub/payouts")}` +
          "&refreshOnSuccess=1";
        router.push(webUrl as never);
      }
    } catch {
      setError("Failed to get setup link");
    }
  };

  const handlePayout = async () => {
    setPayoutLoading(true);
    setError(null);
    try {
      await apiPost("/api/seller-funds", {});
      load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Payout failed");
    } finally {
      setPayoutLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>My Payouts</Text>

      {!data?.hasStripeConnect ? (
        <View style={styles.setupCard}>
          <Text style={styles.setupText}>
            When you sell items on Community Resale, earnings are added to your balance. Complete
            Stripe Connect setup to receive payouts to your bank account.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
            onPress={handleSetup}
          >
            <Text style={styles.btnText}>Complete payment setup</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.cards}>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Available balance</Text>
              <Text style={styles.balance}>{formatPrice(data?.balanceCents ?? 0)}</Text>
            </View>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Total earned</Text>
              <Text style={styles.balance}>{formatPrice(data?.totalEarnedCents ?? 0)}</Text>
            </View>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Total paid out</Text>
              <Text style={styles.balance}>{formatPrice(data?.totalPaidOutCents ?? 0)}</Text>
            </View>
          </View>

          <Text style={styles.hint}>
            Funds from resale and storefront sales are added to your balance. Request a payout to
            your bank account when ready.
          </Text>

          {error && <Text style={styles.err}>{error}</Text>}

          <Pressable
            style={({ pressed }) => [
              styles.btn,
              pressed && { opacity: 0.8 },
              ((data?.balanceCents ?? 0) < 100 || payoutLoading) && styles.btnDisabled,
            ]}
            onPress={handlePayout}
            disabled={payoutLoading || (data?.balanceCents ?? 0) < 100}
          >
            {payoutLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.btnText}>Request payout</Text>
            )}
          </Pressable>

          {(data?.balanceCents ?? 0) < 100 && (
            <Text style={styles.minHint}>Minimum payout is $1.00</Text>
          )}

          {data?.transactions && data.transactions.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Recent transactions</Text>
              {data.transactions.slice(0, 10).map((t) => (
                <View key={t.id} style={styles.txnRow}>
                  <Text style={styles.txnDesc}>{t.description ?? t.type}</Text>
                  <Text style={t.amountCents >= 0 ? styles.txnPos : styles.txnNeg}>
                    {t.amountCents >= 0 ? "+" : ""}{formatPrice(t.amountCents)}
                  </Text>
                </View>
              ))}
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8, color: theme.colors.heading },
  setupCard: {
    backgroundColor: theme.colors.creamAlt ?? "#fefce8",
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.cream ?? "#fef9c3",
  },
  setupText: { fontSize: 15, color: "#333", marginBottom: 16 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  balanceCard: {
    flex: 1,
    minWidth: 100,
    backgroundColor: "#f5f5f5",
    padding: 16,
    borderRadius: 8,
  },
  cardLabel: { fontSize: 12, color: "#666", marginBottom: 4 },
  balance: { fontSize: 20, fontWeight: "700", color: "#333" },
  hint: { fontSize: 14, color: "#666", marginBottom: 16 },
  err: { color: "#c62828", marginBottom: 12, fontSize: 14 },
  btn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  minHint: { fontSize: 12, color: "#888", marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginTop: 24, marginBottom: 8 },
  txnRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  txnDesc: { fontSize: 14, color: "#333", flex: 1 },
  txnPos: { fontSize: 14, color: "#2e7d32" },
  txnNeg: { fontSize: 14, color: "#c62828" },
});
