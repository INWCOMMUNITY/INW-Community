import { useCallback, useEffect, useState, useRef, useMemo, Fragment } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Modal,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "@/lib/theme";
import { apiGet, apiPatch, apiPost, apiPostWithRetry } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileChatRealtime } from "@/lib/use-mobile-chat-realtime";
import {
  type LiveSocketMessagePayload,
  type LiveResaleOfferUpdatePayload,
  OPTIMISTIC_MSG_ID_PREFIX,
  newOptimisticMessageId,
} from "@/lib/chat-live-types";
import { normalizeRouteParam } from "@/lib/normalize-route-param";
import { setOpenChatConversationId } from "@/lib/chat-notification-suppression";
import { useChatBottomPullRefresh } from "@/lib/use-chat-bottom-pull-refresh";
import { useChatScrollToLatest } from "@/lib/use-chat-scroll-to-latest";
import { firstStorePhotoUrl, resolveMediaUrl } from "@/lib/resolve-media-url";
import {
  ChatIncomingActivityFooter,
  ChatSeenLine,
  LocalComposerTypingPreview,
  type ChatTypingPeer,
} from "@/components/ChatTypingRow";

function formatPriceCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function parseOfferDollarsToCents(s: string): number | null {
  const n = parseFloat(String(s).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

interface ResaleOfferSnapshot {
  id: string;
  status: string;
  amountCents: number;
  counterAmountCents: number | null;
  finalAmountCents: number | null;
  respondedAt: string | null;
  acceptedAt: string | null;
  checkoutDeadlineAt: string | null;
}

function snapshotFromLiveOffer(p: NonNullable<LiveSocketMessagePayload["resaleOffer"]>): ResaleOfferSnapshot {
  return {
    id: p.id,
    status: p.status,
    amountCents: p.amountCents,
    counterAmountCents: p.counterAmountCents,
    finalAmountCents: p.finalAmountCents,
    respondedAt: p.respondedAt,
    acceptedAt: p.acceptedAt,
    checkoutDeadlineAt: p.checkoutDeadlineAt,
  };
}

interface ResaleConversation {
  id: string;
  buyerLastReadAt?: string | null;
  sellerLastReadAt?: string | null;
  storeItem: {
    id: string;
    title: string;
    slug: string;
    photos?: string[] | null;
    listingType?: string;
    memberId?: string;
    status?: string;
    quantity?: number;
    acceptOffers?: boolean;
    minOfferCents?: number | null;
    priceCents?: number | null;
  };
  buyer: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  seller: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
  messages: Array<{
    id: string;
    content: string;
    createdAt: string;
    senderId: string;
    resaleOfferId?: string | null;
    sender?: { id: string; firstName: string; lastName: string; profilePhotoUrl?: string | null };
    resaleOffer?: ResaleOfferSnapshot | null;
  }>;
}

export default function ResaleConversationScreen() {
  const { id: rawConvId } = useLocalSearchParams<{ id: string }>();
  const convId = normalizeRouteParam(rawConvId as string | string[] | undefined);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { member, loading: authLoading } = useAuth();
  const [conv, setConv] = useState<ResaleConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [seeItemOpen, setSeeItemOpen] = useState(false);
  const [listRefreshing, setListRefreshing] = useState(false);
  const composerInputRef = useRef<TextInput | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const outboundLockRef = useRef(false);
  const offerAcceptedAlertShownRef = useRef<Set<string>>(new Set());

  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [offerDollars, setOfferDollars] = useState("");
  const [offerNote, setOfferNote] = useState("");
  const [offerSubmitting, setOfferSubmitting] = useState(false);
  const [counterModalOpen, setCounterModalOpen] = useState(false);
  const [counterOfferId, setCounterOfferId] = useState<string | null>(null);
  const [counterDollars, setCounterDollars] = useState("");
  const [offerActionLoading, setOfferActionLoading] = useState<string | null>(null);

  useChatScrollToLatest(flatListRef, {
    conversationId: convId,
    ready: Boolean(conv && !loading),
  });

  const load = useCallback(async () => {
    if (!convId) return;
    try {
      const data = await apiGet<ResaleConversation>(`/api/resale-conversations/${convId}`);
      setConv(data);
      if (data?.id) {
        apiPatch(`/api/resale-conversations/${convId}/read`).catch(() => {});
      }
    } catch {
      setConv(null);
    } finally {
      setLoading(false);
    }
  }, [convId]);

  const onListRefresh = useCallback(async () => {
    setListRefreshing(true);
    try {
      await load();
    } finally {
      setListRefreshing(false);
    }
  }, [load]);

  const { onScroll: onBottomPullScroll, scrollEventThrottle } = useChatBottomPullRefresh(
    onListRefresh,
    listRefreshing
  );

  useEffect(() => {
    if (!convId) {
      setLoading(false);
      setConv(null);
      return;
    }
    load();
  }, [load, convId]);

  const resaleTypingNames = useMemo(() => {
    if (!conv?.buyer?.id || !conv?.seller?.id) return undefined;
    return {
      [conv.buyer.id]: conv.buyer.firstName ?? "Member",
      [conv.seller.id]: conv.seller.firstName ?? "Member",
    };
  }, [conv]);

  const onLiveResaleMessage = useCallback((p: LiveSocketMessagePayload) => {
    if (p.conversationId !== convId) return;
    setConv((prev) => {
      if (!prev) return prev;
      if (prev.messages.some((m) => m.id === p.messageId)) return prev;
      const messages = prev.messages.filter(
        (m) =>
          !(
            m.id.startsWith(OPTIMISTIC_MSG_ID_PREFIX) &&
            m.senderId === p.senderId &&
            m.content === p.content
          )
      );
      const resaleOffer = p.resaleOffer ? snapshotFromLiveOffer(p.resaleOffer) : undefined;
      return {
        ...prev,
        messages: [
          ...messages,
          {
            id: p.messageId,
            content: p.content,
            createdAt: p.createdAt,
            senderId: p.senderId,
            resaleOfferId: resaleOffer?.id ?? null,
            sender: p.sender
              ? {
                  id: p.sender.id,
                  firstName: p.sender.firstName,
                  lastName: p.sender.lastName,
                  profilePhotoUrl: p.sender.profilePhotoUrl ?? null,
                }
              : { id: p.senderId, firstName: "", lastName: "", profilePhotoUrl: null },
            resaleOffer,
          },
        ],
      };
    });
  }, [convId]);

  const onLiveOfferUpdate = useCallback(
    (p: LiveResaleOfferUpdatePayload) => {
      if (p.conversationId !== convId || !member?.id) return;
      setConv((prev) => {
        if (!prev) return prev;
        const snap = snapshotFromLiveOffer(p.resaleOffer);
        const nextMessages = prev.messages.map((m) => {
          if (m.id !== p.messageId) return m;
          return { ...m, resaleOfferId: snap.id, resaleOffer: snap };
        });
        const next = { ...prev, messages: nextMessages };
        if (
          p.resaleOffer.status === "accepted" &&
          prev.buyer.id === member.id &&
          !offerAcceptedAlertShownRef.current.has(p.resaleOffer.id)
        ) {
          offerAcceptedAlertShownRef.current.add(p.resaleOffer.id);
          queueMicrotask(() => {
            Alert.alert(
              "Offer accepted",
              "This item was added to your cart at the agreed price. You have 24 hours to check out.",
              [
                { text: "Later", style: "cancel" },
                { text: "View cart", onPress: () => (router.push as (h: string) => void)("/cart") },
              ]
            );
          });
        }
        return next;
      });
    },
    [convId, member?.id, router]
  );

  const {
    typingPeerIds,
    peerPresenceIds,
    localComposerTypingActive,
    onComposerChange,
    stopComposerTyping,
    onComposerFocusChange,
  } = useMobileChatRealtime("resale", convId, member?.id, load, {
    flatListRef,
    memberNamesById: resaleTypingNames,
    authLoading,
    onLiveMessage: onLiveResaleMessage,
    onLiveOfferUpdate,
    isComposerFocused: () => composerInputRef.current?.isFocused() ?? false,
  });

  const localTypingPeer = useMemo((): ChatTypingPeer | null => {
    if (!member?.id) return null;
    return {
      id: member.id,
      name: `${member.firstName ?? ""} ${member.lastName ?? ""}`.trim() || "You",
      photoUrl: resolveMediaUrl(member.profilePhotoUrl ?? undefined) ?? null,
    };
  }, [member]);

  const typingPeersResolved = useMemo((): ChatTypingPeer[] => {
    if (!conv || !member?.id || typingPeerIds.length === 0) return [];
    const other = conv.buyer.id === member.id ? conv.seller : conv.buyer;
    const peerTyping = typingPeerIds.filter((tid) => tid && tid !== member.id);
    if (peerTyping.length === 0) return [];
    return peerTyping.map((tid) => {
      const m = tid === conv.buyer.id ? conv.buyer : tid === conv.seller.id ? conv.seller : other;
      return {
        id: tid,
        name: `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member",
        photoUrl: resolveMediaUrl(m.profilePhotoUrl ?? undefined) ?? null,
      };
    });
  }, [conv, member?.id, typingPeerIds]);

  const chatPresencePeers = useMemo((): ChatTypingPeer[] => {
    if (!conv || peerPresenceIds.length === 0) return [];
    return peerPresenceIds.map((id) => {
      const m = id === conv.buyer.id ? conv.buyer : id === conv.seller.id ? conv.seller : null;
      return {
        id,
        name: m ? `${m.firstName ?? ""} ${m.lastName ?? ""}`.trim() || "Member" : "Member",
        photoUrl: m ? resolveMediaUrl(m.profilePhotoUrl ?? undefined) ?? null : null,
      };
    });
  }, [conv, peerPresenceIds]);

  const presenceOnlyPeers = useMemo((): ChatTypingPeer[] => {
    const typingSet = new Set(typingPeerIds);
    return chatPresencePeers.filter((p) => !typingSet.has(p.id));
  }, [chatPresencePeers, typingPeerIds]);

  const showResaleSeen = useMemo(() => {
    if (!conv || !member?.id) return false;
    const uid = member.id;
    const peerRead =
      conv.buyer.id === uid ? conv.sellerLastReadAt : conv.buyerLastReadAt;
    if (!peerRead) return false;
    const myOutbound = conv.messages.filter((m) => m.senderId === uid);
    const lastMine = myOutbound[myOutbound.length - 1];
    if (!lastMine) return false;
    return new Date(peerRead).getTime() >= new Date(lastMine.createdAt).getTime();
  }, [conv, member?.id]);

  useFocusEffect(
    useCallback(() => {
      if (convId) {
        setOpenChatConversationId(convId);
        apiPatch(`/api/resale-conversations/${convId}/read`).catch(() => {});
      }
      return () => setOpenChatConversationId(null);
    }, [convId])
  );

  const otherParty = conv && member?.id
    ? (conv.seller.id === member.id ? conv.buyer : conv.seller)
    : conv?.seller;
  const otherName = otherParty ? `${otherParty.firstName} ${otherParty.lastName}`.trim() : "Unknown";
  const itemTitle = conv?.storeItem?.title ?? "Item";
  const itemPhotoUrl = firstStorePhotoUrl(conv?.storeItem?.photos);

  const viewerIsBuyer = Boolean(conv && member?.id && conv.buyer.id === member.id);
  const viewerIsSeller = Boolean(conv && member?.id && conv.seller.id === member.id);
  const hasPendingOfferForItem = useMemo(() => {
    if (!conv?.messages) return false;
    return conv.messages.some((m) => m.resaleOffer?.status === "pending");
  }, [conv?.messages]);

  const canSendOfferFromChat = useMemo(() => {
    if (!conv || !member?.id || !viewerIsBuyer) return false;
    const si = conv.storeItem;
    if (si.acceptOffers === false) return false;
    if (si.listingType && si.listingType !== "resale") return false;
    if (si.status && si.status !== "active") return false;
    if (typeof si.quantity === "number" && si.quantity < 1) return false;
    return !hasPendingOfferForItem;
  }, [conv, member?.id, viewerIsBuyer, hasPendingOfferForItem]);

  const mergeOfferIntoMessages = (
    messages: ResaleConversation["messages"],
    offerId: string,
    patch: Partial<ResaleOfferSnapshot> & { id?: string }
  ): ResaleConversation["messages"] =>
    messages.map((m) =>
      m.resaleOffer?.id === offerId || m.id === patch.id
        ? {
            ...m,
            resaleOffer: m.resaleOffer
              ? { ...m.resaleOffer, ...patch, id: m.resaleOffer.id }
              : ({
                  id: offerId,
                  status: "pending",
                  amountCents: 0,
                  counterAmountCents: null,
                  finalAmountCents: null,
                  respondedAt: null,
                  acceptedAt: null,
                  checkoutDeadlineAt: null,
                  ...patch,
                } as ResaleOfferSnapshot),
          }
        : m
    );

  const patchOfferOnServer = useCallback(
    async (offerId: string, body: Record<string, unknown>, successLabel?: string) => {
      setOfferActionLoading(offerId);
      try {
        const updated = await apiPatch<ResaleOfferSnapshot & { id: string }>(
          `/api/resale-offers/${encodeURIComponent(offerId)}`,
          body
        );
        setConv((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            messages: prev.messages.map((m) =>
              m.resaleOffer?.id === offerId
                ? {
                    ...m,
                    resaleOffer: {
                      id: offerId,
                      status: updated.status,
                      amountCents: updated.amountCents,
                      counterAmountCents: updated.counterAmountCents ?? null,
                      finalAmountCents: updated.finalAmountCents ?? null,
                      respondedAt: updated.respondedAt ?? null,
                      acceptedAt: updated.acceptedAt ?? null,
                      checkoutDeadlineAt: updated.checkoutDeadlineAt ?? null,
                    },
                  }
                : m
            ),
          };
        });
        if (successLabel === "buyer_accepted_counter" && member?.id === conv?.buyer.id) {
          if (!offerAcceptedAlertShownRef.current.has(offerId)) {
            offerAcceptedAlertShownRef.current.add(offerId);
            Alert.alert(
              "Offer accepted",
              "This item was added to your cart at the agreed price. You have 24 hours to check out.",
              [
                { text: "Later", style: "cancel" },
                { text: "View cart", onPress: () => (router.push as (h: string) => void)("/cart") },
              ]
            );
          }
        }
      } catch (e) {
        const err = e as { error?: string };
        Alert.alert("Couldn't update offer", err?.error ?? "Try again.");
      } finally {
        setOfferActionLoading(null);
      }
    },
    [member?.id, conv?.buyer.id, router]
  );

  const submitOfferFromChat = async () => {
    const mid = member?.id;
    if (!conv || !convId || !mid || !viewerIsBuyer) return;
    const amountCents = parseOfferDollarsToCents(offerDollars);
    if (amountCents == null || amountCents < 1) {
      Alert.alert("Invalid amount", "Enter a valid dollar amount.");
      return;
    }
    const minC = conv.storeItem.minOfferCents;
    if (minC != null && minC > 0 && amountCents < minC) {
      Alert.alert("Too low", `Offer must be at least ${formatPriceCents(minC)}.`);
      return;
    }
    const preview = `Offer: ${formatPriceCents(amountCents)}`;
    const tempId = newOptimisticMessageId();
    setOfferSubmitting(true);
    setConv((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        messages: [
          ...prev.messages,
          {
            id: tempId,
            content: preview,
            createdAt: new Date().toISOString(),
            senderId: mid,
            resaleOfferId: null,
            sender: {
              id: mid,
              firstName: member.firstName ?? "You",
              lastName: member.lastName ?? "",
              profilePhotoUrl: member.profilePhotoUrl ?? null,
            },
            resaleOffer: {
              id: "__optimistic_offer__",
              status: "pending",
              amountCents,
              counterAmountCents: null,
              finalAmountCents: null,
              respondedAt: null,
              acceptedAt: null,
              checkoutDeadlineAt: null,
            },
          },
        ],
      };
    });
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      const res = await apiPostWithRetry<{
        offer: ResaleOfferSnapshot & { id: string };
        message: ResaleConversation["messages"][0];
      }>("/api/resale-offers", {
        storeItemId: conv.storeItem.id,
        amountCents,
        message: offerNote.trim() || undefined,
        conversationId: convId,
      });
      setOfferModalOpen(false);
      setOfferDollars("");
      setOfferNote("");
      setConv((prev) => {
        if (!prev) return prev;
        const rest = prev.messages.filter((m) => m.id !== tempId);
        const msg = res.message;
        const ro = msg.resaleOffer ?? {
          id: res.offer.id,
          status: res.offer.status,
          amountCents: res.offer.amountCents,
          counterAmountCents: res.offer.counterAmountCents ?? null,
          finalAmountCents: res.offer.finalAmountCents ?? null,
          respondedAt: res.offer.respondedAt ?? null,
          acceptedAt: res.offer.acceptedAt ?? null,
          checkoutDeadlineAt: res.offer.checkoutDeadlineAt ?? null,
        };
        return {
          ...prev,
          messages: [
            ...rest,
            {
              id: msg.id,
              content: msg.content,
              createdAt: msg.createdAt,
              senderId: msg.senderId ?? mid,
              resaleOfferId: ro.id,
              sender: msg.sender ?? {
                id: msg.senderId ?? mid,
                firstName: member.firstName ?? "You",
                lastName: member.lastName ?? "",
                profilePhotoUrl: member.profilePhotoUrl ?? null,
              },
              resaleOffer: ro,
            },
          ],
        };
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (e) {
      const err = e as { error?: string };
      setConv((prev) => (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) } : null));
      Alert.alert("Offer not sent", err?.error ?? "Try again.");
    } finally {
      setOfferSubmitting(false);
    }
  };

  const navigateToStoreItem = useCallback(() => {
    if (!conv?.storeItem?.slug) return;
    setSeeItemOpen(false);
    (router.push as (href: string) => void)(
      `/product/${conv.storeItem.slug}?listingType=resale`
    );
  }, [conv?.storeItem?.slug, router]);

  const handleReportConversation = () => {
    setMenuOpen(false);
    if (!convId) return;
    Alert.alert(
      "Report conversation",
      "Why are you reporting this conversation?",
      [
        { text: "Political content", onPress: () => submitReport("political") },
        { text: "Nudity / explicit", onPress: () => submitReport("nudity") },
        { text: "Spam", onPress: () => submitReport("spam") },
        { text: "Other", onPress: () => submitReport("other") },
        { text: "Cancel", style: "cancel" },
      ]
    );
  };
  const submitReport = async (reason: "political" | "hate" | "nudity" | "spam" | "other") => {
    if (!convId) return;
    try {
      await apiPost("/api/reports", {
        contentType: "resale_message",
        contentId: convId,
        reason,
      });
      Alert.alert("Report submitted", "Thank you. We will review this.");
    } catch (e) {
      Alert.alert("Couldn't submit", (e as { error?: string }).error ?? "Try again.");
    }
  };

  const handleBlockUser = () => {
    setMenuOpen(false);
    if (!otherParty) return;
    Alert.alert(
      "Block user",
      `Block ${otherName}? They will not be able to message you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Block",
          style: "destructive",
          onPress: async () => {
            try {
              await apiPost("/api/members/block", { memberId: otherParty.id });
              await apiPost("/api/reports", {
                contentType: "resale_message",
                contentId: convId ?? "",
                reason: "other",
                details: "User blocked by viewer",
              }).catch(() => {});
              router.back();
              Alert.alert("User blocked", "They have been blocked.");
            } catch (e) {
              Alert.alert("Error", (e as { error?: string }).error ?? "Could not block user.");
            }
          },
        },
      ]
    );
  };

  const submitCounterOffer = useCallback(async () => {
    if (!counterOfferId) return;
    const cents = parseOfferDollarsToCents(counterDollars);
    if (cents == null || cents < 1) {
      Alert.alert("Invalid amount", "Enter a valid counter amount.");
      return;
    }
    setCounterModalOpen(false);
    const oid = counterOfferId;
    setCounterOfferId(null);
    setCounterDollars("");
    await patchOfferOnServer(oid, { status: "countered", counterAmountCents: cents });
  }, [counterOfferId, counterDollars, patchOfferOnServer]);

  const send = async () => {
    if (!conv || !message.trim() || !member?.id) return;
    if (outboundLockRef.current || sending) return;
    outboundLockRef.current = true;
    const memberId = member.id;
    const text = message.trim();
    const tempId = newOptimisticMessageId();
    stopComposerTyping();
    setMessage("");
    const selfFirst = member.firstName ?? "You";
    setConv((prev) =>
      prev
        ? {
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: tempId,
                content: text,
                createdAt: new Date().toISOString(),
                senderId: memberId,
                sender: {
                  id: memberId,
                  firstName: selfFirst,
                  lastName: member.lastName ?? "",
                  profilePhotoUrl: member.profilePhotoUrl ?? null,
                },
              },
            ],
          }
        : null
    );
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);
    setSending(true);
    try {
      const msg = await apiPostWithRetry<{
        id: string;
        content: string;
        createdAt: string;
        senderId: string;
        sender: { id: string; firstName: string; lastName: string; profilePhotoUrl: string | null };
      }>(`/api/resale-conversations/${convId}`, { content: text });
      setConv((prev) => {
        if (!prev) return null;
        const rest = prev.messages.filter((m) => m.id !== tempId);
        return {
          ...prev,
          messages: [
            ...rest,
            {
              id: msg.id,
              content: msg.content,
              createdAt: msg.createdAt,
              senderId: msg.senderId,
              sender: msg.sender ? { ...msg.sender, id: msg.senderId } : undefined,
            },
          ],
        };
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    } catch {
      setConv((prev) =>
        prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) } : null
      );
      setMessage(text);
    } finally {
      outboundLockRef.current = false;
      setSending(false);
      if (composerInputRef.current?.isFocused()) onComposerFocusChange(true);
    }
  };

  if (loading || !conv) {
    return (
      <View style={styles.container}>
        <View style={[styles.headerGreen, styles.headerGreenLoading, { paddingTop: insets.top + 28 }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </Pressable>
          <Text style={[styles.headerTitle, styles.headerTitleLoading]}>Resale</Text>
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
    >
      <View style={styles.chatTopChrome}>
        <View style={[styles.headerGreen, { paddingTop: insets.top + 28 }]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </Pressable>
            <View style={styles.headerCenter}>
              {itemPhotoUrl ? (
                <Image
                  source={{ uri: itemPhotoUrl }}
                  style={styles.headerAvatar}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
                  <Ionicons name="bag-outline" size={24} color="#fff" />
                </View>
              )}
              <View style={styles.headerTextCol}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  {itemTitle}
                </Text>
                <Text style={styles.headerSub} numberOfLines={1}>
                  with {otherName}
                </Text>
              </View>
            </View>
            <Pressable onPress={() => setMenuOpen(true)} style={styles.headerMenuBtn}>
              <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
            </Pressable>
          </View>

          <Pressable
            style={styles.seeItemBar}
            onPress={() => setSeeItemOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityLabel={seeItemOpen ? "Hide item details" : "See item, show details"}
          >
            <Ionicons name="bag-outline" size={20} color={theme.colors.cream} />
            <Text style={styles.seeItemBarText}>See Item</Text>
            <View style={styles.seeItemBannerSpacer} />
            <Ionicons
              name={seeItemOpen ? "chevron-up" : "chevron-down"}
              size={22}
              color={theme.colors.cream}
            />
          </Pressable>
        </View>

        {seeItemOpen ? (
          <View style={styles.seeItemFlyout}>
            {itemPhotoUrl ? (
              <Image
                source={{ uri: itemPhotoUrl }}
                style={styles.seeItemPanelImage}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.seeItemPanelImage, styles.seeItemPanelImagePlaceholder]}>
                <Ionicons name="image-outline" size={28} color={theme.colors.primary} />
              </View>
            )}
            <View style={styles.seeItemPanelBody}>
              <Text style={styles.seeItemPanelTitle} numberOfLines={3}>
                {itemTitle}
              </Text>
              <Pressable
                style={({ pressed }) => [styles.seeItemPanelBtn, pressed && { opacity: 0.9 }]}
                onPress={navigateToStoreItem}
              >
                <Text style={styles.seeItemPanelBtnText}>View Listing</Text>
                <Ionicons name="open-outline" size={18} color="#fff" />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {menuOpen && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
          <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
            <View style={styles.menuSheet}>
              <Pressable style={styles.menuItem} onPress={handleReportConversation}>
                <Ionicons name="flag-outline" size={20} color="#c00" />
                <Text style={[styles.menuItemText, { color: "#c00" }]}>Report conversation</Text>
              </Pressable>
              {otherParty && (
                <Pressable style={styles.menuItem} onPress={handleBlockUser}>
                  <Ionicons name="ban-outline" size={20} color="#c00" />
                  <Text style={[styles.menuItemText, { color: "#c00" }]}>Block user</Text>
                </Pressable>
              )}
              <Pressable style={styles.menuItem} onPress={() => setMenuOpen(false)}>
                <Ionicons name="close" size={20} color="#666" />
                <Text style={styles.menuItemText}>Cancel</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      )}

      <FlatList
        ref={flatListRef}
        style={styles.messageListFlex}
        data={conv.messages ?? []}
        extraData={`${conv.messages?.length ?? 0}-${conv.messages?.map((m) => m.resaleOffer?.status ?? "").join(",")}-${typingPeersResolved.length}-${chatPresencePeers.length}-${showResaleSeen}-${localComposerTypingActive}-${seeItemOpen}-${offerActionLoading}`}
        keyExtractor={(item, index) => item.id ?? `msg-${index}`}
        onScroll={onBottomPullScroll}
        scrollEventThrottle={scrollEventThrottle}
        bounces
        overScrollMode="always"
        contentContainerStyle={styles.messageList}
        ListFooterComponent={
          <Fragment>
            {typingPeersResolved.length > 0 || chatPresencePeers.length > 0 ? (
              <ChatIncomingActivityFooter
                typingPeers={typingPeersResolved}
                presenceOnlyPeers={presenceOnlyPeers}
              />
            ) : null}
            {localComposerTypingActive && localTypingPeer ? (
              <LocalComposerTypingPreview peer={localTypingPeer} />
            ) : null}
            <ChatSeenLine visible={showResaleSeen} />
          </Fragment>
        }
        renderItem={({ item }) => {
          const isMe = item.senderId === member?.id;
          const ro = item.resaleOffer;
          const busy = ro ? offerActionLoading === ro.id : false;

          const statusLabel =
            ro?.status === "pending"
              ? "Pending"
              : ro?.status === "accepted"
                ? "Accepted"
                : ro?.status === "declined"
                  ? "Declined"
                  : ro?.status === "countered"
                    ? "Countered"
                    : ro?.status ?? "";

          if (ro) {
            return (
              <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
                <View style={[styles.offerCard, isMe ? styles.offerCardMe : styles.offerCardThem]}>
                  <View style={styles.offerCardHeader}>
                    <Ionicons name="pricetag" size={18} color={isMe ? "#fff" : theme.colors.primary} />
                    <Text style={[styles.offerCardTitle, isMe && styles.offerCardTitleMe]}>Offer</Text>
                  </View>
                  <Text style={[styles.offerAmount, isMe && styles.offerAmountMe]}>
                    {formatPriceCents(ro.amountCents)}
                  </Text>
                  <Text style={[styles.offerStatus, isMe && styles.offerStatusMe]}>{statusLabel}</Text>
                  {ro.status === "countered" && ro.counterAmountCents != null ? (
                    <Text style={[styles.offerCounterLine, isMe && styles.offerCounterLineMe]}>
                      Seller counter: {formatPriceCents(ro.counterAmountCents)}
                    </Text>
                  ) : null}
                  {ro.status === "accepted" && ro.checkoutDeadlineAt ? (
                    <Text style={[styles.offerDeadline, isMe && styles.offerDeadlineMe]}>
                      Checkout by {new Date(ro.checkoutDeadlineAt).toLocaleString()}
                    </Text>
                  ) : null}

                  {viewerIsSeller && ro.status === "pending" ? (
                    <View style={styles.offerActions}>
                      <Pressable
                        style={[styles.offerBtn, styles.offerBtnPrimary]}
                        disabled={busy}
                        onPress={() => {
                          Alert.alert("Accept offer?", "The buyer can check out at their offered price.", [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Accept",
                              onPress: () => void patchOfferOnServer(ro.id, { status: "accepted" }),
                            },
                          ]);
                        }}
                      >
                        <Text style={styles.offerBtnPrimaryText}>{busy ? "…" : "Approve"}</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.offerBtn, styles.offerBtnGhost, isMe && styles.offerBtnGhostOnGreen]}
                        disabled={busy}
                        onPress={() => void patchOfferOnServer(ro.id, { status: "declined" })}
                      >
                        <Text style={[styles.offerBtnGhostText, isMe && styles.offerBtnGhostTextOnGreen]}>
                          Decline
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[styles.offerBtn, styles.offerBtnGhost, isMe && styles.offerBtnGhostOnGreen]}
                        disabled={busy}
                        onPress={() => {
                          setCounterOfferId(ro.id);
                          setCounterDollars("");
                          setCounterModalOpen(true);
                        }}
                      >
                        <Text style={[styles.offerBtnGhostText, isMe && styles.offerBtnGhostTextOnGreen]}>
                          Counter
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {viewerIsBuyer && ro.status === "countered" ? (
                    <View style={styles.offerActions}>
                      <Pressable
                        style={[styles.offerBtn, styles.offerBtnPrimary]}
                        disabled={busy}
                        onPress={() =>
                          void patchOfferOnServer(ro.id, { status: "accepted" }, "buyer_accepted_counter")
                        }
                      >
                        <Text style={styles.offerBtnPrimaryText}>{busy ? "…" : "Accept counter"}</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.offerBtn, styles.offerBtnGhost, isMe && styles.offerBtnGhostOnGreen]}
                        disabled={busy}
                        onPress={() => {
                          Alert.alert("Decline counter?", "The seller will be notified.", [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Decline",
                              style: "destructive",
                              onPress: () => void patchOfferOnServer(ro.id, { status: "declined" }),
                            },
                          ]);
                        }}
                      >
                        <Text style={[styles.offerBtnGhostText, isMe && styles.offerBtnGhostTextOnGreen]}>
                          Decline
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          }

          return (
            <View style={[styles.bubbleWrap, isMe && styles.bubbleWrapMe]}>
              <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
                <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
              </View>
            </View>
          );
        }}
      />

      {listRefreshing ? (
        <View style={styles.chatRefreshingStrip} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      ) : null}

      <Modal visible={offerModalOpen} transparent animationType="fade" onRequestClose={() => setOfferModalOpen(false)}>
        <Pressable style={styles.menuOverlay} onPress={() => setOfferModalOpen(false)}>
          <Pressable style={styles.offerModalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.offerModalTitle}>Send an offer</Text>
            <Text style={styles.offerModalHint}>Amount (USD)</Text>
            <TextInput
              style={styles.offerModalInput}
              placeholder="0.00"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="decimal-pad"
              value={offerDollars}
              onChangeText={setOfferDollars}
            />
            <Text style={styles.offerModalHint}>Note to seller (optional)</Text>
            <TextInput
              style={[styles.offerModalInput, styles.offerModalNote]}
              placeholder="Optional message"
              placeholderTextColor={theme.colors.placeholder}
              value={offerNote}
              onChangeText={setOfferNote}
              multiline
              maxLength={2000}
            />
            <View style={styles.offerModalActions}>
              <Pressable style={styles.offerModalCancel} onPress={() => setOfferModalOpen(false)}>
                <Text style={styles.offerModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.offerModalSend, offerSubmitting && { opacity: 0.6 }]}
                disabled={offerSubmitting}
                onPress={() => void submitOfferFromChat()}
              >
                <Text style={styles.offerModalSendText}>{offerSubmitting ? "Sending…" : "Send offer"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={counterModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCounterModalOpen(false)}
      >
        <Pressable style={styles.menuOverlay} onPress={() => setCounterModalOpen(false)}>
          <Pressable style={styles.offerModalSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.offerModalTitle}>Counter offer</Text>
            <Text style={styles.offerModalHint}>Your price (USD)</Text>
            <TextInput
              style={styles.offerModalInput}
              placeholder="0.00"
              placeholderTextColor={theme.colors.placeholder}
              keyboardType="decimal-pad"
              value={counterDollars}
              onChangeText={setCounterDollars}
            />
            <View style={styles.offerModalActions}>
              <Pressable
                style={styles.offerModalCancel}
                onPress={() => {
                  setCounterModalOpen(false);
                  setCounterOfferId(null);
                }}
              >
                <Text style={styles.offerModalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.offerModalSend} onPress={() => void submitCounterOffer()}>
                <Text style={styles.offerModalSendText}>Send counter</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <View
        style={[
          styles.inputRow,
          {
            paddingBottom:
              12 + Math.max(insets.bottom, Platform.OS === "android" ? 12 : 0),
          },
        ]}
      >
        {canSendOfferFromChat ? (
          <Pressable
            style={({ pressed }) => [styles.pricetagBtn, pressed && { opacity: 0.85 }]}
            onPress={() => setOfferModalOpen(true)}
            accessibilityLabel="Send offer"
          >
            <Ionicons name="pricetag-outline" size={22} color={theme.colors.primary} />
          </Pressable>
        ) : null}
        <TextInput
          ref={composerInputRef}
          style={[styles.input, canSendOfferFromChat && styles.inputWithPricetag]}
          placeholder="Message..."
          placeholderTextColor={theme.colors.placeholder}
          value={message}
          onChangeText={(t) => onComposerChange(t, setMessage)}
          multiline
          maxLength={5000}
          blurOnSubmit={false}
          autoCorrect={true}
          onFocus={() => onComposerFocusChange(true)}
          onBlur={() => onComposerFocusChange(false)}
        />
        <Pressable
          style={({ pressed }) => [styles.sendBtn, (!message.trim() || sending) && styles.sendBtnDisabled, pressed && { opacity: 0.8 }]}
          onPress={send}
          disabled={!message.trim() || sending}
        >
          <Ionicons name="send" size={22} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  chatTopChrome: {
    zIndex: 10,
    elevation: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  headerGreen: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  headerGreenLoading: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 18,
    borderBottomWidth: 2,
    borderBottomColor: "#000",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 6,
  },
  seeItemBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginTop: 4,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.35)",
  },
  seeItemBarText: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.cream,
  },
  seeItemBannerSpacer: { flex: 1 },
  seeItemFlyout: {
    flexDirection: "row",
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 12,
    backgroundColor: "#fff",
  },
  backBtn: { padding: 8 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  headerAvatar: { width: 52, height: 52, borderRadius: 26 },
  headerAvatarPlaceholder: {
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  seeItemPanelImage: {
    width: 76,
    height: 76,
    borderRadius: 8,
    backgroundColor: "#f0f0f0",
  },
  seeItemPanelImagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  seeItemPanelBody: { flex: 1, minWidth: 0, justifyContent: "center", gap: 10 },
  seeItemPanelTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.heading,
    lineHeight: 20,
  },
  seeItemPanelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
  },
  seeItemPanelBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
  headerTextCol: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 19, fontWeight: "700", color: "#fff" },
  headerTitleLoading: { flex: 1, marginLeft: 4 },
  headerSub: { fontSize: 14, color: "rgba(255,255,255,0.92)", marginTop: 3 },
  headerMenuBtn: { padding: 8 },
  menuOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end", paddingBottom: 40 },
  menuSheet: { backgroundColor: "#fff", borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 16, color: theme.colors.heading },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  messageListFlex: { flex: 1 },
  messageList: { padding: 16, paddingBottom: 8, flexGrow: 1, justifyContent: "flex-end" },
  bubbleWrap: { marginBottom: 12, alignItems: "flex-start" },
  bubbleWrapMe: { alignItems: "flex-end" },
  chatRefreshingStrip: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(0,0,0,0.1)",
    paddingVertical: 8,
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  bubble: {
    maxWidth: "80%",
    padding: 12,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    backgroundColor: theme.colors.cream,
    borderWidth: 2,
    borderColor: "#000",
  },
  bubbleMe: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
    backgroundColor: theme.colors.primary,
  },
  bubbleThem: {},
  bubbleText: { fontSize: 16, color: theme.colors.heading },
  bubbleTextMe: { color: "#fff" },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: "#000",
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.5 },
  pricetagBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    backgroundColor: "#fff",
  },
  inputWithPricetag: { marginLeft: 0 },
  offerCard: {
    maxWidth: "88%",
    padding: 14,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#000",
    backgroundColor: theme.colors.cream,
  },
  offerCardMe: {
    backgroundColor: theme.colors.primary,
    borderColor: "#000",
  },
  offerCardThem: {},
  offerCardHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  offerCardTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.heading },
  offerCardTitleMe: { color: "#fff" },
  offerAmount: { fontSize: 22, fontWeight: "800", color: theme.colors.heading },
  offerAmountMe: { color: "#fff" },
  offerStatus: { fontSize: 13, fontWeight: "600", color: "#444", marginTop: 4 },
  offerStatusMe: { color: "rgba(255,255,255,0.9)" },
  offerCounterLine: { fontSize: 14, fontWeight: "600", color: theme.colors.heading, marginTop: 6 },
  offerCounterLineMe: { color: "#fff" },
  offerDeadline: { fontSize: 12, color: "#555", marginTop: 8 },
  offerDeadlineMe: { color: "rgba(255,255,255,0.85)" },
  offerActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  offerBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#000",
  },
  offerBtnPrimary: { backgroundColor: "#fff" },
  offerBtnPrimaryText: { fontSize: 14, fontWeight: "700", color: theme.colors.primary },
  offerBtnGhost: { backgroundColor: "transparent" },
  offerBtnGhostOnGreen: { borderColor: "rgba(255,255,255,0.85)" },
  offerBtnGhostText: { fontSize: 14, fontWeight: "600", color: theme.colors.heading },
  offerBtnGhostTextOnGreen: { color: "#fff" },
  offerModalSheet: {
    backgroundColor: "#fff",
    marginHorizontal: 20,
    borderRadius: 14,
    padding: 20,
    borderWidth: 2,
    borderColor: "#000",
  },
  offerModalTitle: { fontSize: 18, fontWeight: "800", marginBottom: 12, color: theme.colors.heading },
  offerModalHint: { fontSize: 13, fontWeight: "600", color: "#555", marginBottom: 6 },
  offerModalInput: {
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
    color: "#000",
  },
  offerModalNote: { minHeight: 72, textAlignVertical: "top" },
  offerModalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 8 },
  offerModalCancel: { paddingVertical: 10, paddingHorizontal: 12 },
  offerModalCancelText: { fontSize: 16, fontWeight: "600", color: "#666" },
  offerModalSend: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: theme.colors.primary,
    borderWidth: 2,
    borderColor: "#000",
  },
  offerModalSendText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
