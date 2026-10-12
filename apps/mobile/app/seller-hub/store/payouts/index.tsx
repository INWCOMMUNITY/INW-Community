import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { theme } from "@/lib/theme";
import { apiGet, apiPost } from "@/lib/api";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");
const TRANSACTIONS_PAGE_SIZE = 10;
const BURGUNDY = "#800020";
const BURGUNDY_PRESSED = "#6b001b";
const TAN_LIGHT = "#f7f3ee";

interface TransactionBreakdown {
  itemAndShippingCents: number;
  salesTaxCents: number;
  salesTaxReserveCents: number;
  processingFeeCents: number;
  stripeTaxProductFeeCents?: number;
  stripeFeesCents?: number;
  optionalPlatformFeeCents: number;
  sellerTransferCents: number;
  note: string;
}

interface Transaction {
  id: string;
  type: string;
  amountCents: number;
  description: string | null;
  createdAt: string;
  breakdown?: TransactionBreakdown | null;
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
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function formatSigned(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${formatPrice(cents)}`;
}

function stripeFeesCents(breakdown: TransactionBreakdown): number {
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
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  const load = useCallback(() => {
    apiGet<FundsData | { error: string }>("/api/seller-funds")
      .then((d) => {
        if (d && typeof d === "object" && "error" in d && d.error) {
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
    try {
      const res = await apiPost<{ url?: string; reused?: boolean }>("/api/stripe/connect/onboard", {
        returnBaseUrl: siteBase,
        mobileReturnPath: "/seller-hub/store/payouts",
      });
      if (res?.reused) {
        load();
        return;
      }
      if (res?.url) {
        const webUrl = `/web?url=${encodeURIComponent(res.url)}&title=${encodeURIComponent("Payment Setup")}`;
        router.push(webUrl as never);
      }
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Payment setup failed");
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

  const handleManageAccount = async () => {
    setError(null);
    try {
      const d = await apiGet<{ url?: string; error?: string }>("/api/stripe/connect/express-dashboard");
      if (d?.url) {
        const webUrl =
          `/web?url=${encodeURIComponent(d.url)}&title=${encodeURIComponent("Stripe Dashboard")}` +
          `&successRoute=${encodeURIComponent("/seller-hub/store/payouts")}`;
        (router.push as (href: string) => void)(webUrl);
      } else {
        setError(d?.error ?? "Could not open payment account");
      }
    } catch {
      setError("Could not open payment account");
    }
  };

  const handleDisconnectStripe = async () => {
    setDisconnectConfirmOpen(false);
    setDisconnectLoading(true);
    setError(null);
    try {
      await apiPost("/api/me/disconnect-stripe", {});
      load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      setError(err?.error ?? "Could not disconnect");
    } finally {
      setDisconnectLoading(false);
    }
  };

  const availableCents =
    data?.availableForPayoutCents !== undefined ? data.availableForPayoutCents : data?.balanceCents ?? 0;

  const infoItems = [
    "Stripe fees (card processing ~2.9% + $0.30, and Stripe Tax 0.5% when sales tax is collected) and a 1% sales tax reserve are withheld from each sale before funds are sent to your Connect account.",
    data?.payoutScheduleDescription ?? "Funds typically available in 2 business days",
    "Once available, Stripe pays out to your linked bank automatically on its schedule — no approval needed in your Stripe dashboard. Funds do not sit in your Connect account forever.",
    "Send to Bank requests a payout now if you have available balance and do not want to wait for the next automatic transfer. Open Stripe Dashboard to manage bank details and payout history.",
    "Buyer-paid sales tax stays with the platform for remittance. INW handles submitting all sales tax.",
  ];

  if (loading) {
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
        <View style={styles.errorCard}>
          <Text style={styles.err}>{error}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
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

  const transactions = data?.transactions ?? [];
  const visibleTransactions = transactions.slice(0, visibleTransactionCount);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>My Funds</Text>

      {!data?.hasStripeConnect ? (
        <View style={styles.setupCard}>
          <Text style={styles.setupText}>
            Complete Stripe Connect setup to receive payouts from sales.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={handleSetup}
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
            {(data?.pendingCents ?? 0) > 0 ? (
              <View style={styles.balanceCard}>
                <Text style={styles.cardLabel}>Pending</Text>
                <Text style={styles.balance}>{formatPrice(data?.pendingCents ?? 0)}</Text>
                {data?.payoutScheduleDescription ? (
                  <Text style={styles.cardHint}>{data.payoutScheduleDescription}</Text>
                ) : null}
              </View>
            ) : null}
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Total Earned</Text>
              <Text style={styles.balance}>{formatPrice(data?.totalEarnedCents ?? 0)}</Text>
            </View>
            <View style={styles.balanceCard}>
              <Text style={styles.cardLabel}>Total Paid Out</Text>
              <Text style={styles.balance}>{formatPrice(data?.totalPaidOutCents ?? 0)}</Text>
            </View>
          </View>

          <Pressable
            style={styles.infoToggle}
            onPress={() => setInfoOpen((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: infoOpen }}
          >
            <Ionicons name="information-circle-outline" size={20} color="#666" />
            <Text style={styles.infoToggleText}>Payout info</Text>
            <Ionicons
              name={infoOpen ? "chevron-up-outline" : "chevron-down-outline"}
              size={16}
              color="#888"
            />
          </Pressable>
          {infoOpen ? (
            <View style={styles.infoPanel}>
              {infoItems.map((item) => (
                <View key={item} style={styles.infoRow}>
                  <Text style={styles.infoBullet}>•</Text>
                  <Text style={styles.infoText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.actions}>
            <View style={styles.actionStack}>
              <Pressable
                style={({ pressed }) => [styles.outlineBtn, pressed && styles.outlineBtnPressed]}
                onPress={handleManageAccount}
              >
                {({ pressed }) => (
                  <Text style={[styles.outlineBtnText, pressed && styles.outlineBtnTextPressed]}>
                    Open Stripe Dashboard
                  </Text>
                )}
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.disconnectBtn,
                  pressed && styles.disconnectBtnPressed,
                  disconnectLoading && styles.btnDisabled,
                ]}
                onPress={() => setDisconnectConfirmOpen(true)}
                disabled={disconnectLoading}
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
                pressed && !payoutLoading && availableCents >= 100 && styles.btnPressed,
                (availableCents < 100 || payoutLoading) && styles.btnDisabled,
              ]}
              onPress={handlePayout}
              disabled={payoutLoading || availableCents < 100}
            >
              {payoutLoading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.btnText}>Send to Bank</Text>
              )}
            </Pressable>
          </View>

          {availableCents < 100 ? (
            <Text style={styles.minHint}>Minimum payout is $1.00</Text>
          ) : null}

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.err}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.historyNote}>
            View full payout history and bank details in your{" "}
            <Text style={styles.historyLink} onPress={handleManageAccount}>
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
                      style={[styles.txnRow, index === 0 && styles.txnRowFirst]}
                    >
                      <View style={styles.txnTop}>
                        <View style={styles.txnMain}>
                          <Text style={styles.txnMeta}>
                            {new Date(t.createdAt).toLocaleDateString()} · {t.type}
                          </Text>
                          <Text style={styles.txnDesc}>{t.description ?? "—"}</Text>
                        </View>
                        <Text style={t.amountCents >= 0 ? styles.txnPos : styles.txnNeg}>
                          {t.amountCents >= 0 ? "+" : ""}
                          {formatSigned(t.amountCents)}
                        </Text>
                      </View>
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
                          <Text style={styles.breakStrong}>
                            Sent to your Connect account: {formatPrice(t.breakdown.sellerTransferCents)}
                          </Text>
                          {t.breakdown.note ? (
                            <Text style={styles.breakNote}>{t.breakdown.note}</Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              {visibleTransactionCount < transactions.length ? (
                <View style={styles.moreWrap}>
                  <Text style={styles.moreCount}>
                    Showing {Math.min(visibleTransactionCount, transactions.length)} of{" "}
                    {transactions.length}
                  </Text>
                  <Pressable
                    style={({ pressed }) => [styles.pillBtn, pressed && styles.btnPressed]}
                    onPress={() =>
                      setVisibleTransactionCount((n) =>
                        Math.min(n + TRANSACTIONS_PAGE_SIZE, transactions.length)
                      )
                    }
                  >
                    <Text style={styles.pillBtnText}>See More</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.emptyTx}>No transactions yet.</Text>
          )}
        </>
      )}

      <Modal visible={disconnectConfirmOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Are you sure?</Text>
            <Text style={styles.modalBody}>
              Disconnect your Stripe account? Your listings will be disabled until you complete
              payment setup again.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalCancel, pressed && { backgroundColor: "#f5f5f5" }]}
                onPress={() => setDisconnectConfirmOpen(false)}
                disabled={disconnectLoading}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalConfirm,
                  pressed && { backgroundColor: BURGUNDY_PRESSED },
                ]}
                onPress={handleDisconnectStripe}
                disabled={disconnectLoading}
              >
                <Text style={styles.modalConfirmText}>Yes, Disconnect</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  title: {
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 20,
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  setupCard: {
    backgroundColor: "#fffbeb",
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  setupText: { fontSize: 15, color: "#333", marginBottom: 16 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  balanceCard: {
    flexGrow: 1,
    flexBasis: "46%",
    backgroundColor: "#f5f5f5",
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e5e5",
  },
  cardLabel: { fontSize: 13, color: "#737373", marginBottom: 4 },
  balance: {
    fontSize: 24,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
  },
  cardHint: { fontSize: 11, color: "#737373", marginTop: 4 },
  infoToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
    alignSelf: "flex-start",
  },
  infoToggleText: { fontSize: 14, color: "#525252" },
  infoPanel: {
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 10,
    backgroundColor: TAN_LIGHT,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  infoRow: { flexDirection: "row", gap: 8 },
  infoBullet: { color: "#525252", fontSize: 14, lineHeight: 20 },
  infoText: { flex: 1, fontSize: 14, lineHeight: 20, color: "#525252" },
  actions: { gap: 12, marginTop: 8, marginBottom: 8 },
  actionStack: { gap: 8 },
  btn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
  },
  sendBtn: { alignSelf: "stretch" },
  btnPressed: { backgroundColor: theme.colors.earth },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 16 },
  outlineBtn: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    backgroundColor: "#fff",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  outlineBtnPressed: { backgroundColor: theme.colors.earth, borderColor: theme.colors.earth },
  outlineBtnText: { color: theme.colors.heading, fontWeight: "600", fontSize: 16 },
  outlineBtnTextPressed: { color: "#fff" },
  disconnectBtn: {
    backgroundColor: BURGUNDY,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  disconnectBtnPressed: { backgroundColor: BURGUNDY_PRESSED },
  disconnectBtnText: { color: "#fff", fontWeight: "600", fontSize: 12 },
  minHint: { fontSize: 13, color: "#737373", marginBottom: 8 },
  errorCard: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  err: { color: "#b91c1c", fontSize: 14 },
  historyNote: { fontSize: 13, color: "#737373", marginTop: 8, marginBottom: 4 },
  historyLink: { color: theme.colors.heading, textDecorationLine: "underline" },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 16,
    marginBottom: 10,
    color: theme.colors.heading,
  },
  emptyTx: { fontSize: 14, color: "#737373" },
  txnList: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 10,
    overflow: "hidden",
  },
  txnRow: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    backgroundColor: "#fff",
  },
  txnRowFirst: { borderTopWidth: 0 },
  txnTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  txnMain: { flex: 1 },
  txnMeta: { fontSize: 12, color: "#737373", textTransform: "capitalize", marginBottom: 2 },
  txnDesc: { fontSize: 14, color: "#333" },
  txnPos: { fontSize: 15, fontWeight: "700", color: theme.colors.primary },
  txnNeg: { fontSize: 15, fontWeight: "700", color: "#dc2626" },
  breakdown: { marginTop: 8, gap: 2 },
  breakLine: { fontSize: 12, color: "#525252" },
  breakStrong: { fontSize: 12, fontWeight: "600", color: "#262626", marginTop: 2 },
  breakNote: { fontSize: 11, color: "#737373", marginTop: 4, lineHeight: 15 },
  moreWrap: { marginTop: 16, alignItems: "center", gap: 8 },
  moreCount: { fontSize: 12, color: "#737373" },
  pillBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 22,
  },
  pillBtnText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.heading,
    fontFamily: theme.fonts.heading,
    marginBottom: 8,
  },
  modalBody: { fontSize: 14, color: "#525252", lineHeight: 20, marginBottom: 18 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  modalCancel: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "#fff",
  },
  modalCancelText: { color: theme.colors.heading, fontWeight: "600", fontSize: 14 },
  modalConfirm: {
    backgroundColor: BURGUNDY,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  modalConfirmText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});
