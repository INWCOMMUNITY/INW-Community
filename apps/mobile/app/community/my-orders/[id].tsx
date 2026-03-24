import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Linking,
  Image,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatShippingAddress } from "@/lib/format-address";
import { getOrderStatusLabel } from "@/lib/order-status";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

interface OrderItemRow {
  id: string;
  quantity: number;
  priceCentsAtPurchase: number;
  fulfillmentType?: string | null;
  pickupDetails?: Record<string, unknown> | null;
  storeItem?: { id: string; title: string; slug: string; photos: string[] };
}

interface StoreOrder {
  id: string;
  status: string;
  totalCents: number;
  shippingCostCents?: number;
  createdAt: string;
  shippingAddress?: unknown;
  localDeliveryDetails?: Record<string, unknown> | null;
  pickupSellerConfirmedAt?: string | null;
  pickupBuyerConfirmedAt?: string | null;
  deliveryConfirmedAt?: string | null;
  deliveryBuyerConfirmedAt?: string | null;
  refundRequestedAt?: string | null;
  refundReason?: string | null;
  cancelReason?: string | null;
  cancelNote?: string | null;
  isCashOrder?: boolean;
  orderNumber?: string;
  paymentLabel?: string;
  buyer?: { firstName: string; lastName: string; email?: string | null };
  seller?: {
    firstName: string;
    lastName: string;
    businesses: { name: string; slug: string }[];
  };
  items?: OrderItemRow[];
  shipment?: { trackingNumber?: string | null; carrier?: string } | null;
}

const REFUND_REASONS = ["Changed my mind", "Didn't mean to order", "Order Arrived Damaged", "Wrong Item Delivered", "Other"] as const;
const CANCEL_REASONS = ["Changed my mind", "Didn't mean to order", "Order Arrived Damaged", "Wrong Item Delivered", "Other"] as const;

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolvePhotoUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${siteBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function getTrackingUrl(carrier: string | undefined | null, trackingNumber: string): string {
  const n = trackingNumber.trim();
  if (!n) return `https://www.google.com/search?q=track+${encodeURIComponent(trackingNumber)}`;
  const c = (carrier ?? "").toUpperCase();
  if (c === "USPS") return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`;
  if (c === "UPS") return `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`;
  if (c === "FEDEX") return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`;
  return `https://www.google.com/search?q=track+${encodeURIComponent(n)}`;
}

function formatFulfillmentName(details: Record<string, unknown> | null | undefined): string {
  const fn = String(details?.firstName ?? "").trim();
  const ln = String(details?.lastName ?? "").trim();
  return [fn, ln].filter(Boolean).join(" ") || "Customer";
}

export default function MyOrderDetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const orderId = typeof idParam === "string" ? idParam : Array.isArray(idParam) ? idParam[0] : undefined;
  const router = useRouter();
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refundModal, setRefundModal] = useState(false);
  const [refundReason, setRefundReason] = useState("");
  const [refundOther, setRefundOther] = useState("");
  const [refundNote, setRefundNote] = useState("");
  const [requestingRefund, setRequestingRefund] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOther, setCancelOther] = useState("");
  const [cancelNote, setCancelNote] = useState("");
  const [canceling, setCanceling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [ticketModal, setTicketModal] = useState<
    { kind: "pickup"; item: OrderItemRow } | { kind: "delivery" } | null
  >(null);
  const [confirmingTicket, setConfirmingTicket] = useState(false);

  const load = useCallback(() => {
    if (!orderId) {
      setLoading(false);
      setError("Order not found");
      setOrder(null);
      return Promise.resolve();
    }
    setError(null);
    return apiGet<StoreOrder | { error: string }>(`/api/store-orders/${orderId}`)
      .then((data) => {
        if (data && typeof data === "object" && "error" in data) {
          setError((data as { error: string }).error);
          setOrder(null);
        } else if (data && typeof data === "object" && "id" in data) {
          setOrder(data as StoreOrder);
        } else {
          setError("Invalid response. Pull to refresh.");
          setOrder(null);
        }
      })
      .catch((e) => {
        const err = e as { error?: string };
        setError(err.error ?? "Failed to load order");
        setOrder(null);
      })
      .finally(() => setLoading(false));
  }, [orderId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const requestRefund = useCallback(async () => {
    if (!orderId || !refundReason.trim()) {
      Alert.alert("Select a reason", "Please select a reason for your refund request.");
      return;
    }
    if (refundReason === "Other" && !refundOther.trim()) {
      Alert.alert("Provide details", "Please provide details for \"Other\".");
      return;
    }
    setRequestingRefund(true);
    try {
      await apiPost(`/api/store-orders/${orderId}/request-refund`, {
        reason: refundReason,
        otherReason: refundReason === "Other" ? refundOther : undefined,
        note: refundNote.trim() || undefined,
      });
      setRefundModal(false);
      setRefundReason("");
      setRefundOther("");
      setRefundNote("");
      load();
      Alert.alert("Request sent", "Your refund request was submitted. The seller will review it.");
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to submit refund request.");
    } finally {
      setRequestingRefund(false);
    }
  }, [orderId, refundReason, refundOther, refundNote, load]);

  const cancelOrder = useCallback(async () => {
    if (!orderId) return;
    setCanceling(true);
    try {
      const res = await apiPost<{ refunded?: boolean }>(`/api/store-orders/${orderId}/cancel`, {
        reason: cancelReason || undefined,
        otherReason: cancelReason === "Other" ? cancelOther : undefined,
        note: cancelNote.trim() || undefined,
      });
      setCancelConfirm(false);
      setCancelReason("");
      setCancelOther("");
      setCancelNote("");
      load();
      Alert.alert("Order canceled", res?.refunded ? "Your order was canceled and a refund will be processed." : "Your order was canceled.");
    } catch (e) {
      const err = e as { error?: string };
      Alert.alert("Error", err.error ?? "Failed to cancel order.");
    } finally {
      setCanceling(false);
    }
  }, [orderId, cancelReason, cancelOther, cancelNote, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  const confirmPickupReceived = useCallback(async () => {
    if (!orderId) return;
    setConfirmingTicket(true);
    try {
      await apiPatch(`/api/store-orders/${orderId}`, { pickupBuyerConfirmed: true });
      setTicketModal(null);
      load();
    } catch {
      Alert.alert("Could not update", "Please try again.");
    } finally {
      setConfirmingTicket(false);
    }
  }, [orderId, load]);

  const confirmDeliveryReceived = useCallback(async () => {
    if (!orderId) return;
    setConfirmingTicket(true);
    try {
      await apiPatch(`/api/store-orders/${orderId}`, { deliveryBuyerConfirmed: true });
      setTicketModal(null);
      load();
    } catch {
      Alert.alert("Could not update", "Please try again.");
    } finally {
      setConfirmingTicket(false);
    }
  }, [orderId, load]);

  const viewMode: "loading" | "error" | "content" =
    loading && !order ? "loading" : error || !order ? "error" : "content";
  const sellerName = order
    ? (order.seller?.businesses?.[0]?.name ??
      (`${order.seller?.firstName ?? ""} ${order.seller?.lastName ?? ""}`.trim() || "Seller"))
    : "";
  const shippingAddressStr = order && order.shippingAddress
    ? formatShippingAddress(order.shippingAddress)
    : null;
  const trackingNumber = order?.shipment?.trackingNumber?.trim();
  const trackingUrl = trackingNumber
    ? getTrackingUrl(order?.shipment?.carrier ?? null, trackingNumber)
    : null;
  const hasLocalDelivery =
    order?.items?.some((i) => (i.fulfillmentType ?? "") === "local_delivery") ?? false;
  const orderNumberDisplay = order?.orderNumber ?? order?.id.slice(-8).toUpperCase();
  const paymentLabelText =
    order?.paymentLabel ?? (order?.isCashOrder ? "Cash due" : "Paid online");

  return viewMode === "loading" ? (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={theme.colors.primary} />
    </View>
  ) : viewMode === "error" ? (
    <View style={styles.center}>
      <Text style={styles.errorText}>{error ?? "Order not found"}</Text>
      <View style={styles.errorButtons}>
        <Pressable style={styles.backBtn} onPress={() => load()}>
          <Text style={styles.backBtnText}>Retry</Text>
        </Pressable>
        <Pressable style={styles.backBtnOutline} onPress={() => router.back()}>
          <Text style={styles.backBtnOutlineText}>Back to My Orders</Text>
        </Pressable>
      </View>
    </View>
  ) : order ? (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />}
    >
      <View style={styles.section}>
        <Text style={styles.label}>Order #</Text>
        <Text style={styles.value}>#{order.id.slice(-8).toUpperCase()}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Status</Text>
        <Text style={[styles.value, styles.statusCapitalize]}>{getOrderStatusLabel(order.status)}</Text>
      </View>

      {order.status === "canceled" && (order.cancelReason ?? order.cancelNote) && (
        <View style={styles.cancelReasonSection}>
          <Text style={styles.cancelReasonText}>
            {[order.cancelReason, order.cancelNote].filter(Boolean).join(order.cancelReason && order.cancelNote ? " — " : "")}
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>Payment</Text>
        <Text style={[styles.value, order.isCashOrder && { color: "#92400e" }]}>
          {paymentLabelText}
        </Text>
        {order.isCashOrder && (
          <Text style={styles.paymentHint}>Pay when you pick up or receive delivery. No payment button needed.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Placed</Text>
        <Text style={styles.value}>{formatDate(order.createdAt)}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.label}>Seller</Text>
        <Text style={styles.value}>{sellerName}</Text>
      </View>

      {order.items && order.items.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Items</Text>
          {order.items.map((oi) => {
            const photos = (oi.storeItem?.photos ?? []).filter(Boolean);
            const photoUrls = photos.map((p) => resolvePhotoUrl(p)).filter((u): u is string => !!u);
            const firstPhotoUrl = photoUrls[0];
            return (
              <View key={oi.id} style={styles.itemRow}>
                <View style={styles.itemPhotos}>
                  {firstPhotoUrl ? (
                    <Image source={{ uri: firstPhotoUrl }} style={styles.itemThumb} />
                  ) : (
                    <View style={[styles.itemThumb, styles.itemThumbPlaceholder]}>
                      <Text style={styles.itemThumbText}>
                        {oi.storeItem?.title?.[0] ?? "?"}
                      </Text>
                    </View>
                  )}
                  {photoUrls.length > 1 ? (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      style={styles.itemPhotosRow}
                      contentContainerStyle={styles.itemPhotosRowContent}
                    >
                      {photoUrls.slice(1).map((uri, idx) => (
                        <Image key={idx} source={{ uri }} style={styles.itemThumbSmall} />
                      ))}
                    </ScrollView>
                  ) : null}
                </View>
                <View style={styles.itemBody}>
                  <Text style={styles.itemTitle}>
                    {oi.storeItem?.title ?? "Item"} × {oi.quantity}
                  </Text>
                  <Text style={styles.itemPrice}>
                    {formatPrice(oi.priceCentsAtPurchase * oi.quantity)}
                  </Text>
                  {(oi.fulfillmentType ?? "") === "pickup" &&
                    (order.status === "paid" || order.status === "shipped" || order.status === "delivered") && (
                    <Pressable
                      style={({ pressed }) => [styles.ticketBtn, pressed && { opacity: 0.85 }]}
                      onPress={() => setTicketModal({ kind: "pickup", item: oi })}
                    >
                      <Ionicons name="hand-left-outline" size={16} color={theme.colors.primary} />
                      <Text style={styles.ticketBtnText}>Pick Up Ticket</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
          {hasLocalDelivery &&
            (order.status === "paid" || order.status === "shipped" || order.status === "delivered") && (
            <Pressable
              style={({ pressed }) => [styles.ticketBtnWide, pressed && { opacity: 0.85 }]}
              onPress={() => setTicketModal({ kind: "delivery" })}
            >
              <Ionicons name="car-outline" size={18} color={theme.colors.primary} />
              <Text style={styles.ticketBtnText}>Delivery Ticket</Text>
            </Pressable>
          )}
        </View>
      )}

      {order.shippingCostCents != null && order.shippingCostCents > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Shipping</Text>
          <Text style={styles.value}>{formatPrice(order.shippingCostCents)}</Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.label}>Total</Text>
        <Text style={styles.totalValue}>{formatPrice(order.totalCents)}</Text>
      </View>

      {shippingAddressStr && (
        <View style={styles.section}>
          <Text style={styles.label}>Shipping address</Text>
          <Text style={styles.value}>{shippingAddressStr}</Text>
        </View>
      )}

      {trackingNumber && (
        <View style={styles.section}>
          <Text style={styles.label}>Tracking</Text>
          <Text style={styles.value}>
            {order.shipment?.carrier && `${order.shipment.carrier} — `}
            {trackingNumber}
          </Text>
          {trackingUrl && (
            <Pressable
              style={({ pressed }) => [styles.trackBtn, pressed && { opacity: 0.8 }]}
              onPress={() => Linking.openURL(trackingUrl)}
            >
              <Ionicons name="open-outline" size={18} color="#fff" />
              <Text style={styles.trackBtnText}>Track shipment</Text>
            </Pressable>
          )}
        </View>
      )}

      {order.refundRequestedAt && (
        <View style={styles.refundBanner}>
          <Ionicons name="information-circle" size={20} color="#92400e" />
          <Text style={styles.refundBannerText}>
            Refund requested {new Date(order.refundRequestedAt).toLocaleDateString()}.
            {order.refundReason ? ` Reason: ${order.refundReason}` : ""} The seller will review your request.
          </Text>
        </View>
      )}

      <View style={styles.actionsSection}>
        {order.status === "paid" && !order.refundRequestedAt && (
          <>
            {!order.isCashOrder && (
              <Pressable
                style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.8 }]}
                onPress={() => setRefundModal(true)}
                disabled={requestingRefund}
              >
                <Text style={styles.actionBtnText}>{requestingRefund ? "Submitting…" : "Request refund"}</Text>
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [styles.actionBtnOutline, pressed && { opacity: 0.8 }]}
              onPress={() => setCancelConfirm(true)}
              disabled={canceling}
            >
              <Text style={styles.actionBtnOutlineText}>{canceling ? "Canceling…" : "Cancel order"}</Text>
            </Pressable>
          </>
        )}
        {order.items && order.items.length > 0 && order.items[0].storeItem?.slug && (
          <Pressable
            style={({ pressed }) => [styles.actionBtnOutline, pressed && { opacity: 0.8 }]}
            onPress={() => (router.push as (href: string) => void)(`/product/${order.items![0].storeItem!.slug}`)}
          >
            <Text style={styles.actionBtnOutlineText}>Order again</Text>
          </Pressable>
        )}
      </View>

      <Modal visible={refundModal} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => !requestingRefund && setRefundModal(false)}>
          <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Request refund</Text>
            <Text style={styles.modalLabel}>Reason</Text>
            <ScrollView style={styles.reasonScroll} nestedScrollEnabled>
              {REFUND_REASONS.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.reasonOption, refundReason === r && styles.reasonOptionActive]}
                  onPress={() => setRefundReason(r)}
                >
                  <Text style={[styles.reasonOptionText, refundReason === r && styles.reasonOptionTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {refundReason === "Other" && (
              <TextInput
                style={styles.input}
                placeholder="Please specify"
                placeholderTextColor="#999"
                value={refundOther}
                onChangeText={setRefundOther}
                autoCorrect={true}
              />
            )}
            <Text style={styles.modalLabel}>Note (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Additional details for the seller"
              placeholderTextColor="#999"
              value={refundNote}
              onChangeText={setRefundNote}
              multiline
              numberOfLines={2}
              autoCorrect={true}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalBtnCancel} onPress={() => !requestingRefund && setRefundModal(false)} disabled={requestingRefund}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtnSubmit, requestingRefund && styles.modalBtnDisabled]} onPress={requestRefund} disabled={requestingRefund}>
                <Text style={styles.modalBtnSubmitText}>{requestingRefund ? "Submitting…" : "Submit request"}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={cancelConfirm} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => !canceling && setCancelConfirm(false)}>
          <View style={styles.modalPanel} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Cancel order</Text>
            <Text style={styles.cancelHint}>
              {order.isCashOrder
                ? "This order was paid in cash. Canceling will release the items back to the seller. No refund is involved."
                : "This will cancel your order and refund the amount to your original payment method."}
            </Text>
            <Text style={styles.modalLabel}>Reason (optional)</Text>
            <ScrollView style={styles.reasonScroll} nestedScrollEnabled>
              {CANCEL_REASONS.map((r) => (
                <Pressable
                  key={r}
                  style={[styles.reasonOption, cancelReason === r && styles.reasonOptionActive]}
                  onPress={() => setCancelReason(r)}
                >
                  <Text style={[styles.reasonOptionText, cancelReason === r && styles.reasonOptionTextActive]}>{r}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {cancelReason === "Other" && (
              <TextInput
                style={styles.input}
                placeholder="Please specify"
                placeholderTextColor="#999"
                value={cancelOther}
                onChangeText={setCancelOther}
                autoCorrect={true}
              />
            )}
            <Text style={styles.modalLabel}>Note (optional)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Additional details"
              placeholderTextColor="#999"
              value={cancelNote}
              onChangeText={setCancelNote}
              multiline
              numberOfLines={2}
              autoCorrect={true}
            />
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalBtnCancel} onPress={() => !canceling && setCancelConfirm(false)} disabled={canceling}>
                <Text style={styles.modalBtnCancelText}>Back</Text>
              </Pressable>
              <Pressable style={[styles.modalBtnSubmit, canceling && styles.modalBtnDisabled]} onPress={cancelOrder} disabled={canceling}>
                <Text style={styles.modalBtnSubmitText}>{canceling ? "Canceling…" : "Cancel order"}</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!ticketModal && !!order} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => !confirmingTicket && setTicketModal(null)}>
          <View style={styles.ticketModalPanel} onStartShouldSetResponder={() => true}>
            {ticketModal?.kind === "pickup" && order && (
              <>
                <View style={styles.ticketIconRow}>
                  <Ionicons name="hand-left-outline" size={40} color={theme.colors.primary} />
                </View>
                <Text style={styles.modalTitle}>Pick up ticket</Text>
                {(() => {
                  const oi = ticketModal.item;
                  const name = formatFulfillmentName(oi.pickupDetails as Record<string, unknown> | null | undefined);
                  const photos = (oi.storeItem?.photos ?? []).filter(Boolean);
                  const photoUrl = photos[0] ? resolvePhotoUrl(photos[0]) : undefined;
                  return (
                    <>
                      {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.ticketPhoto} /> : null}
                      <Text style={styles.ticketName}>{name}</Text>
                      <Text style={styles.ticketMeta}>Order #{orderNumberDisplay}</Text>
                      <Text style={styles.ticketMeta}>Payment: {paymentLabelText}</Text>
                      {order.pickupBuyerConfirmedAt ? (
                        <Text style={styles.ticketDone}>You marked this as received.</Text>
                      ) : (
                        <Pressable
                          style={({ pressed }) => [styles.ticketConfirmBtn, pressed && { opacity: 0.85 }]}
                          onPress={confirmPickupReceived}
                          disabled={confirmingTicket}
                        >
                          {confirmingTicket ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.ticketConfirmBtnText}>Mark received</Text>
                          )}
                        </Pressable>
                      )}
                    </>
                  );
                })()}
                <Pressable style={styles.ticketCloseBtn} onPress={() => setTicketModal(null)} disabled={confirmingTicket}>
                  <Text style={styles.ticketCloseBtnText}>Close</Text>
                </Pressable>
              </>
            )}
            {ticketModal?.kind === "delivery" && order && (
              <>
                <View style={styles.ticketIconRow}>
                  <Ionicons name="car-outline" size={40} color={theme.colors.primary} />
                </View>
                <Text style={styles.modalTitle}>Delivery ticket</Text>
                {(() => {
                  const d = order.localDeliveryDetails as Record<string, unknown> | null | undefined;
                  const name = formatFulfillmentName(d);
                  const ldItem = order.items?.find((i) => (i.fulfillmentType ?? "") === "local_delivery");
                  const photos = (ldItem?.storeItem?.photos ?? []).filter(Boolean);
                  const photoUrl = photos[0] ? resolvePhotoUrl(photos[0]) : undefined;
                  return (
                    <>
                      {photoUrl ? <Image source={{ uri: photoUrl }} style={styles.ticketPhoto} /> : null}
                      <Text style={styles.ticketName}>{name}</Text>
                      <Text style={styles.ticketMeta}>Order #{orderNumberDisplay}</Text>
                      <Text style={styles.ticketMeta}>Payment: {paymentLabelText}</Text>
                      {order.deliveryBuyerConfirmedAt ? (
                        <Text style={styles.ticketDone}>You marked this as received.</Text>
                      ) : (
                        <Pressable
                          style={({ pressed }) => [styles.ticketConfirmBtn, pressed && { opacity: 0.85 }]}
                          onPress={confirmDeliveryReceived}
                          disabled={confirmingTicket}
                        >
                          {confirmingTicket ? (
                            <ActivityIndicator color="#fff" />
                          ) : (
                            <Text style={styles.ticketConfirmBtnText}>Mark received</Text>
                          )}
                        </Pressable>
                      )}
                    </>
                  );
                })()}
                <Pressable style={styles.ticketCloseBtn} onPress={() => setTicketModal(null)} disabled={confirmingTicket}>
                  <Text style={styles.ticketCloseBtnText}>Close</Text>
                </Pressable>
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      <View style={{ height: 32 }} />
    </ScrollView>
  ) : null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
  },
  section: { marginBottom: 20 },
  label: {
    fontSize: 12,
    color: "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  value: { fontSize: 16, color: "#333" },
  paymentHint: { fontSize: 13, color: "#666", marginTop: 4, fontStyle: "italic" },
  statusCapitalize: { textTransform: "capitalize" },
  itemRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  itemPhotos: { marginRight: 12 },
  itemThumb: { width: 80, height: 80, borderRadius: 8 },
  itemThumbSmall: { width: 48, height: 48, borderRadius: 6, marginLeft: 6 },
  itemPhotosRow: { marginTop: 6, maxHeight: 52 },
  itemPhotosRowContent: { paddingRight: 8 },
  itemThumbPlaceholder: {
    backgroundColor: theme.colors.cream,
    justifyContent: "center",
    alignItems: "center",
    width: 80,
    height: 80,
  },
  itemThumbText: { fontSize: 18, fontWeight: "600", color: theme.colors.primary },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { fontSize: 15, color: "#333" },
  itemPrice: { fontSize: 15, fontWeight: "600", color: theme.colors.primary, marginTop: 2 },
  ticketBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: "#fff",
  },
  ticketBtnWide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.creamAlt ?? "#faf8f5",
  },
  ticketBtnText: { fontSize: 14, fontWeight: "600", color: theme.colors.primary },
  ticketModalPanel: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "100%",
    maxWidth: 360,
  },
  ticketIconRow: { alignItems: "center", marginBottom: 8 },
  ticketPhoto: { width: "100%", height: 160, borderRadius: 12, marginBottom: 16, resizeMode: "cover" },
  ticketName: { fontSize: 20, fontWeight: "700", color: "#333", marginBottom: 8 },
  ticketMeta: { fontSize: 14, color: "#666", marginBottom: 4 },
  ticketDone: { fontSize: 14, color: "#2e7d32", marginTop: 12, fontWeight: "600" },
  ticketConfirmBtn: {
    marginTop: 16,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  ticketConfirmBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  ticketCloseBtn: { marginTop: 12, paddingVertical: 10, alignItems: "center" },
  ticketCloseBtnText: { fontSize: 16, color: "#666", fontWeight: "600" },
  totalValue: { fontSize: 18, fontWeight: "700", color: theme.colors.primary },
  trackBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignSelf: "flex-start",
  },
  trackBtnText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  errorText: { fontSize: 16, color: "#666", textAlign: "center", marginBottom: 16 },
  errorButtons: { flexDirection: "row", gap: 12, marginTop: 8 },
  backBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: theme.colors.primary,
    borderRadius: 8,
  },
  backBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  backBtnOutline: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
  },
  backBtnOutlineText: { color: theme.colors.primary, fontSize: 16, fontWeight: "600" },
  refundBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 20,
    padding: 12,
    backgroundColor: "#fef3c7",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fde68a",
  },
  refundBannerText: { flex: 1, fontSize: 14, color: "#92400e" },
  cancelReasonSection: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: theme.colors.creamAlt,
    borderRadius: 8,
  },
  cancelReasonText: { fontSize: 14, color: theme.colors.text },
  actionsSection: { gap: 12, marginTop: 8 },
  actionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    alignSelf: "flex-start",
  },
  actionBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  actionBtnOutline: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignSelf: "flex-start",
  },
  actionBtnOutlineText: { color: theme.colors.primary, fontSize: 16, fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalPanel: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    width: "100%",
    maxWidth: 360,
    maxHeight: "80%",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 16, color: "#333" },
  modalLabel: { fontSize: 14, fontWeight: "600", color: "#333", marginBottom: 8, marginTop: 12 },
  cancelHint: { fontSize: 14, color: "#666", marginBottom: 12 },
  reasonScroll: { maxHeight: 160, marginBottom: 8 },
  reasonOption: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  reasonOptionActive: { borderColor: theme.colors.primary, backgroundColor: theme.colors.cream ?? "#f5f5f5" },
  reasonOptionText: { fontSize: 15, color: "#333" },
  reasonOptionTextActive: { fontWeight: "600", color: theme.colors.primary },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 8,
  },
  inputMultiline: { minHeight: 60, textAlignVertical: "top" },
  modalButtons: { flexDirection: "row", gap: 12, marginTop: 20, justifyContent: "flex-end" },
  modalBtnCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  modalBtnCancelText: { fontSize: 16, color: "#666" },
  modalBtnSubmit: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
  },
  modalBtnSubmitText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  modalBtnDisabled: { opacity: 0.7 },
});
