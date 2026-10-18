import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const TRANSACTIONS_PAGE_SIZE = 10;

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  description: string | null;
  createdAt: string;
  breakdown?: {
    itemAndShippingCents: number;
    salesTaxCents: number;
    salesTaxReserveCents: number;
    processingFeeCents: number;
    stripeTaxProductFeeCents?: number;
    stripeFeesCents?: number;
    optionalPlatformFeeCents: number;
    sellerTransferCents: number;
    note: string;
  } | null;
}

interface FundsData {
  balanceCents: number;
  totalEarnedCents: number;
  totalPaidOutCents: number;
  transactions: Transaction[];
  hasStripeConnect: boolean;
  availableForPayoutCents?: number;
  pendingCents?: number;
  payoutScheduleDescription?: string;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function stripeFeesCents(breakdown: NonNullable<Transaction["breakdown"]>): number {
  return (
    breakdown.stripeFeesCents ??
    breakdown.processingFeeCents + (breakdown.stripeTaxProductFeeCents ?? 0)
  );
}

export default function PayoutsScreen() {
  const router = useRouter();
  const [data, setData] = useState<FundsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [payoutLoading, setPayoutLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleTransactionCount, setVisibleTransactionCount] = useState(TRANSACTIONS_PAGE_SIZE);
  const [infoOpen, setInfoOpen] = useState(false);

  const load = useCallback(() => {
    apiGet<FundsData | { error: string }>("/api/seller-funds")
      .then((d) => {
        if ("error" in d && d.error) {
          setError(d.error);
          return;
        }
        setError(null);
        setData(d as FundsData);
        setVisibleTransactionCount(TRANSACTIONS_PAGE_SIZE);
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSetup = async () => {
    setError(null);
    try {
      const res = await apiPost<{ url?: string; reused?: boolean; error?: string }>(
        "/api/stripe/connect/onboard",
        {
          returnBaseUrl: siteBase,
          mobileReturnPath: "/seller-hub",
        }
      );
      if (res?.reused) {
        load();
        return;
      }
      if (res?.url) {
        const webUrl = `/web?url=${encodeURIComponent(res.url)}&title=${encodeURIComponent("Payment Setup")}`;
        router.push(webUrl as never);
        return;
      }
      setError(res?.error ?? "Payment setup failed");
    } catch (e: unknown) {
      setError((e as { error?: string })?.error ?? "Failed to get setup link");
    }
  };

  const handlePayout = async () => {
    setPayoutLoading(true);
    setError(null);
    try {
      await apiPost("/api/seller-funds", {});
      load();
    } catch (e: unknown) {
      setError((e as { error?: string })?.error ?? "Payout failed");
    } finally {
      setPayoutLoading(false);
    }
  };

  const handleManageAccount = async () => {
    setError(null);
    try {
      const d = await apiGet<{ url?: string; error?: string }>("/api/stripe/connect/express-dashboard");
      if (d?.url) {
        const webUrl =
          `/web?url=${encodeURIComponent(d.url)}&title=Payment Account` +
          `&successRoute=${encodeURIComponent("/seller-hub/store/payouts")}`;
        (router.push as (href: string) => void)(webUrl);
      } else {
        setError(d?.error ?? "Could not open payment account");
      }
    } catch (e: unknown) {
      setError((e as { error?: string })?.error ?? "Could not open payment account");
    }
  };

  const handleDisconnectStripe = () => {
    Alert.alert(
      "Are you sure?",
      "Disconnect your Stripe account? Your listings will be disabled until you complete payment setup again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Disconnect",
          style: "destructive",
          onPress: async () => {
            setDisconnectLoading(true);
            setError(null);
            try {
              await apiPost("/api/me/disconnect-stripe", {});
              load();
            } catch (e: unknown) {
              setError((e as { error?: string })?.error ?? "Could not disconnect");
            } finally {
              setDisconnectLoading(false);
            }
          },
        },
      ]
    );
  };

  const availableCents =
    data?.availableForPayoutCents !== undefined ? data.availableForPayoutCents : data?.balanceCents ?? 0;
  const transactions = data?.transactions ?? [];
  const visibleTransactions = transactions.slice(0, visibleTransactionCount);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (error && !data) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.title}>My Funds</Text>
        <View style={styles.errorBox}>
          <Text style={styles.err}>{error}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
          onPress={() => {
            setError(null);
            setLoading(true);
            load();
          }}
        >
          <Text style={styles.btnText}>Try Again</Text>
        </Pressable>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>My Funds</Text>

      {!data?.hasStripeConnect ? (
        <View style={styles.setupCard}>
          <Text style={styles.setupText}>Complete Stripe Connect setup to receive payouts from sales.</Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]}
            onPress={() => void handleSetup()}
          >
            <Text style={styles.btnText}>Complete Payment Setup</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.cards}>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Available for Payout</Text>
              <Text style={styles.balance}>{formatPrice(availableCents)}</Text>
              <Text style={styles.cardHint}>Ready to Send to Your Bank</Text>
            </View>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Total Earned</Text>
              <Text style={styles.balance}>{formatPrice(data?.totalEarnedCents ?? 0)}</Text>
            </View>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Total Paid Out</Text>
              <Text style={styles.balance}>{formatPrice(data?.totalPaidOutCents ?? 0)}</Text>
            </View>
          </View>
          {(data?.pendingCents ?? 0) > 0 ? (
            <View style={styles.pendingCard}>
              <Text style={styles.cardLabel}>Pending</Text>
              <Text style={styles.balance}>{formatPrice(data?.pendingCents ?? 0)}</Text>
              {data?.payoutScheduleDescription ? (
                <Text style={styles.cardHint}>{data.payoutScheduleDescription}</Text>
              ) : null}
            </View>
          ) : null}

          <Pressable
            style={styles.infoToggle}
            onPress={() => setInfoOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: infoOpen }}
          >
            <Ionicons name="information-circle-outline" size={20} color="#4b5563" />
            <Text style={styles.infoToggleText}>Payout info</Text>
            <Ionicons
              name={infoOpen ? "chevron-up-outline" : "chevron-down-outline"}
              size={16}
              color="#6b7280"
            />
          </Pressable>
          {infoOpen ? (
            <View style={styles.infoPanel}>
              <Text style={styles.infoBullet}>
                • Stripe fees (card processing ~2.9% + $0.30, and Stripe Tax 0.5% when sales tax is collected) and a
                1% sales tax reserve are withheld from each sale before funds are sent to your Connect account.
              </Text>
              <Text style={styles.infoBullet}>
                • {data?.payoutScheduleDescription ?? "Funds typically available in 2 business days"}
              </Text>
              <Text style={styles.infoBullet}>
                • Once available, Stripe pays out to your linked bank automatically on its schedule — no approval
                needed in your Stripe dashboard. Funds do not sit in your Connect account forever.
              </Text>
              <Text style={styles.infoBullet}>
                • Send to Bank requests a payout now if you have available balance and do not want to wait for the
                next automatic transfer. Open Stripe Dashboard to manage bank details and payout history.
              </Text>
              <Text style={styles.infoBullet}>
                • Buyer-paid sales tax stays with the platform for remittance. INW handles submitting all sales tax.
              </Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <View style={styles.accountCol}>
              <Pressable
                style={({ pressed }) => [styles.outlineBtn, pressed && styles.outlineBtnPressed]}
                onPress={() => void handleManageAccount()}
              >
                {({ pressed }) => (
                  <Text style={[styles.outlineBtnText, pressed && styles.outlineBtnTextPressed]}>
                    Open Stripe Dashboard
                  </Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.disconnectBtn, pressed && { opacity: 0.85 }]}
                onPress={handleDisconnectStripe}
                disabled={disconnectLoading}
                accessibilityLabel="Disconnect Stripe Account"
              >
                <Text style={styles.disconnectBtnText}>
                  {disconnectLoading ? "Disconnecting…" : "Disconnect Stripe Account"}
                </Text>
              </Pressable>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.btn,
                styles.sendBtn,
                pressed && { opacity: 0.8 },
                (availableCents < 100 || payoutLoading) && styles.btnDisabled,
              ]}
              onPress={() => void handlePayout()}
              disabled={payoutLoading || availableCents < 100}
            >
              {payoutLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnText}>Send to Bank</Text>
              )}
            </Pressable>
          </View>

          {availableCents < 100 ? <Text style={styles.minHint}>Minimum payout is $1.00</Text> : null}

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.err}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.historyNote}>
            View full payout history and bank details in your{" "}
            <Text style={styles.historyLink} onPress={() => void handleManageAccount()}>
              payment account
            </Text>
            .
          </Text>

          <Text style={styles.sectionTitle}>Transaction History</Text>
          {visibleTransactions.length > 0 ? (
            <>
              <View style={styles.txnList}>
                {visibleTransactions.map((t, index) => {
                  const fees = t.breakdown ? stripeFeesCents(t.breakdown) : 0;
                  return (
                    <View
                      key={t.id}
                      style={[styles.txnCard, index > 0 && styles.txnCardBorder]}
                    >
                      <View style={styles.txnTop}>
                        <Text style={styles.txnDate}>{new Date(t.createdAt).toLocaleDateString()}</Text>
                        <Text style={t.amountCents >= 0 ? styles.txnPos : styles.txnNeg}>
                          {t.amountCents >= 0 ? "+" : ""}
                          {formatPrice(t.amountCents)}
                        </Text>
                      </View>
                      <Text style={styles.txnType}>{t.type}</Text>
                      <Text style={styles.txnDesc}>{t.description ?? "—"}</Text>
                      {t.breakdown ? (
                        <View style={styles.breakdown}>
                          <Text style={styles.breakLine}>
                            Item + shipping: {formatPrice(t.breakdown.itemAndShippingCents)}
                          </Text>
                          {t.breakdown.salesTaxCents > 0 ? (
                            <Text style={styles.breakLine}>
                              Sales tax (platform keeps): {formatPrice(t.breakdown.salesTaxCents)}
                            </Text>
                          ) : null}
                          {t.breakdown.salesTaxReserveCents > 0 ? (
                            <Text style={styles.breakLine}>
                              1% sales tax reserve: −{formatPrice(t.breakdown.salesTaxReserveCents)}
                            </Text>
                          ) : null}
                          {fees > 0 ? (
                            <Text style={styles.breakLine}>Stripe fees: −{formatPrice(fees)}</Text>
                          ) : null}
                          {t.breakdown.optionalPlatformFeeCents > 0 ? (
                            <Text style={styles.breakLine}>
                              Platform fee: −{formatPrice(t.breakdown.optionalPlatformFeeCents)}
                            </Text>
                          ) : null}
                          <Text style={styles.breakSent}>
                            Sent to your Connect account: {formatPrice(t.breakdown.sellerTransferCents)}
                          </Text>
                          {t.breakdown.note ? <Text style={styles.breakNote}>{t.breakdown.note}</Text> : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              {visibleTransactionCount < transactions.length ? (
                <View style={styles.moreWrap}>
                  <Text style={styles.moreCount}>
                    Showing {Math.min(visibleTransactionCount, transactions.length)} of {transactions.length}
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.btn, styles.moreBtn, pressed && { opacity: 0.85 }]}
                    onPress={() =>
                      setVisibleTransactionCount((n) =>
                        Math.min(n + TRANSACTIONS_PAGE_SIZE, transactions.length)
                      )
                    }
                  >
                    <Text style={styles.btnText}>See More</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.empty}>No transactions yet.</Text>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: {
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 20,
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  setupCard: {
    backgroundColor: "#fffbeb",
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  setupText: { fontSize: 15, color: "#333", marginBottom: 12 },
  cards: { flexDirection: "row", alignItems: "stretch", gap: 8, marginBottom: 12 },
  balanceCard: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: "#f9fafb",
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  pendingCard: {
    backgroundColor: "#f9fafb",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    marginBottom: 12,
  },
  cardLabel: { fontSize: 11, lineHeight: 14, color: "#6b7280", marginBottom: 4, textAlign: "center" },
  balance: { fontSize: 16, fontWeight: "700", color: "#111", textAlign: "center" },
  cardHint: { fontSize: 10, lineHeight: 13, color: "#6b7280", marginTop: 4, textAlign: "center" },
  infoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  infoToggleText: { fontSize: 14, color: "#4b5563" },
  infoPanel: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 8,
    backgroundColor: theme.colors.creamAlt,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    marginBottom: 16,
  },
  infoBullet: { fontSize: 14, color: "#4b5563", lineHeight: 20 },
  actions: { gap: 12, marginTop: 8, marginBottom: 8, alignSelf: "stretch" },
  accountCol: { alignSelf: "stretch", width: "100%", gap: 8 },
  outlineBtn: {
    alignSelf: "stretch",
    width: "100%",
    borderWidth: 1,
    borderColor: "#d1d5db",
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  outlineBtnPressed: { backgroundColor: theme.colors.earth, borderColor: theme.colors.earth },
  outlineBtnText: { color: theme.colors.heading, fontWeight: "600", fontSize: 15 },
  outlineBtnTextPressed: { color: "#fff" },
  disconnectBtn: {
    alignSelf: "stretch",
    width: "100%",
    backgroundColor: "#800020",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  disconnectBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  btn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  sendBtn: { alignSelf: "stretch", width: "100%" },
  moreBtn: { alignSelf: "center", borderRadius: 999, paddingHorizontal: 22 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  minHint: { fontSize: 14, color: "#6b7280", marginBottom: 12 },
  errorBox: {
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  err: { color: "#b91c1c", fontSize: 14 },
  historyNote: { fontSize: 14, color: "#6b7280", marginBottom: 8, lineHeight: 20 },
  historyLink: { textDecorationLine: "underline", color: "#6b7280" },
  sectionTitle: { fontSize: 16, fontWeight: "600", marginBottom: 12, color: "#111" },
  txnList: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, overflow: "hidden" },
  txnCard: { padding: 12, backgroundColor: "#fff" },
  txnCardBorder: { borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  txnTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  txnDate: { fontSize: 14, color: "#111" },
  txnType: { fontSize: 14, color: "#111", textTransform: "capitalize", marginTop: 4 },
  txnDesc: { fontSize: 14, color: "#111", marginTop: 4 },
  breakdown: { marginTop: 8, gap: 2 },
  breakLine: { fontSize: 12, color: "#4b5563" },
  breakSent: { fontSize: 12, color: "#1f2937", fontWeight: "600", marginTop: 2 },
  breakNote: { fontSize: 11, color: "#6b7280", marginTop: 4, lineHeight: 15 },
  txnPos: { fontSize: 14, fontWeight: "600", color: theme.colors.primary },
  txnNeg: { fontSize: 14, fontWeight: "600", color: "#dc2626" },
  moreWrap: { marginTop: 16, alignItems: "center", gap: 8 },
  moreCount: { fontSize: 12, color: "#6b7280" },
  empty: { fontSize: 14, color: "#6b7280" },
});
