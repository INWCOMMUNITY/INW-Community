import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InteractionManager, Platform, type FlatList } from "react-native";
import { io, type Socket } from "socket.io-client";
import { apiGet, getToken } from "./api";
import { getDirectRealtimeUrl } from "./direct-realtime";
import { isLiveSocketMessagePayload, type LiveSocketMessagePayload } from "./chat-live-types";
import { CHAT_COMPOSER_TYPING_REFRESH_MS, CHAT_PEER_TYPING_INDICATOR_TTL_MS } from "./chat-typing-timers";

export type { LiveSocketMessagePayload };

export type MobileChatRealtimeKind = "direct" | "group" | "resale";

const RT = {
  direct: {
    join: "join_direct",
    leave: "leave_direct",
    typingEmit: "direct_typing",
    typingListen: "direct:typing",
    msgListen: "direct:message",
    readListen: "direct:read",
    presence: "direct:presence",
    presenceSnapshot: "direct:presence_snapshot",
  },
  group: {
    join: "join_group",
    leave: "leave_group",
    typingEmit: "group_typing",
    typingListen: "group:typing",
    msgListen: "group:message",
    readListen: "group:read",
    presence: "group:presence",
    presenceSnapshot: "group:presence_snapshot",
  },
  resale: {
    join: "join_resale",
    leave: "leave_resale",
    typingEmit: "resale_typing",
    typingListen: "resale:typing",
    msgListen: "resale:message",
    readListen: "resale:read",
    presence: "resale:presence",
    presenceSnapshot: "resale:presence_snapshot",
  },
} as const;

export function useMobileChatRealtime(
  kind: MobileChatRealtimeKind,
  conversationId: string | undefined,
  memberId: string | undefined,
  load: () => Promise<void>,
  options?: {
    flatListRef?: React.RefObject<FlatList | null>;
    memberNamesById?: Record<string, string>;
    /** When true, skip connecting until auth has finished hydrating (so getToken() is reliable). */
    authLoading?: boolean;
    /** Append incoming message from Socket.IO without waiting for a full refetch (Instagram-style). */
    onLiveMessage?: (payload: LiveSocketMessagePayload) => void;
    /** Typing pings only while the composer is actually focused (keyboard session). */
    isComposerFocused?: () => boolean;
  }
): {
  typingBanner: string | null;
  typingPeerIds: string[];
  peerPresenceIds: string[];
  /** True while the message field is focused (keyboard up) — your green typing preview + socket typing. */
  localComposerTypingActive: boolean;
  onComposerChange: (text: string, setMessage: (t: string) => void) => void;
  stopComposerTyping: () => void;
  /** Call when the message field focuses/blurs (keyboard session). */
  onComposerFocusChange: (focused: boolean) => void;
} {
  const loadRef = useRef(load);
  loadRef.current = load;
  const memberIdRef = useRef(memberId);
  memberIdRef.current = memberId;
  const flatListRefHolder = useRef(options?.flatListRef);
  flatListRefHolder.current = options?.flatListRef;
  const memberNamesById = options?.memberNamesById;
  const authLoading = options?.authLoading ?? false;
  const onLiveMessageRef = useRef(options?.onLiveMessage);
  onLiveMessageRef.current = options?.onLiveMessage;
  const isComposerFocusedProbeRef = useRef(options?.isComposerFocused);
  isComposerFocusedProbeRef.current = options?.isComposerFocused;

  const [typingMemberIds, setTypingMemberIds] = useState<string[]>([]);
  const [peerPresenceIds, setPeerPresenceIds] = useState<string[]>([]);
  const [localComposerTypingActive, setLocalComposerTypingActive] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const composerTypingRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const peerTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const typingPeerIds = useMemo(() => {
    const self = memberId;
    return typingMemberIds.filter((id) => id && id !== self);
  }, [typingMemberIds, memberId]);

  const typingBanner = useMemo(() => {
    if (typingPeerIds.length === 0) return null;
    const names = memberNamesById ?? {};
    if (kind === "group") {
      if (typingPeerIds.length === 1) return `${names[typingPeerIds[0]] ?? "Someone"} is typing…`;
      return `${typingPeerIds.length} people are typing…`;
    }
    return `${names[typingPeerIds[0]] ?? "Member"} is typing…`;
  }, [typingPeerIds, kind, memberNamesById]);

  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  useEffect(() => {
    if (authLoading) return;
    const url = getDirectRealtimeUrl();
    if (!url || !conversationId) return;
    const cfg = RT[kind];
    let cancelled = false;
    let socket: Socket | null = null;
    let emitJoinHandler: (() => void) | null = null;

    void (async () => {
      const token = await getToken();
      const trimmed = token?.trim();
      if (!trimmed || cancelled) return;
      let socketAuth = trimmed;
      try {
        const { token: rt } = await apiGet<{ token: string }>("/api/realtime/token");
        if (typeof rt === "string" && rt.length > 0) socketAuth = rt;
      } catch {
        /* fall back to mobile Bearer */
      }
      if (cancelled) return;
      const transports =
        Platform.OS === "web" ? (["websocket", "polling"] as const) : (["polling", "websocket"] as const);
      socket = io(url, {
        transports: [...transports],
        auth: { token: socketAuth },
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
      });
      socketRef.current = socket;

      const emitJoin = () => {
        const cid = conversationIdRef.current;
        if (!cid || !socket?.connected) return;
        setPeerPresenceIds([]);
        socket.emit(cfg.join, cid, (err?: string) => {
          if (err) {
            console.warn(`[${kind} realtime] join failed:`, err);
            return;
          }
          if (typeof __DEV__ !== "undefined" && __DEV__) {
            console.log(`[${kind} realtime] joined conversation (typing & presence active)`);
          }
        });
      };
      emitJoinHandler = emitJoin;

      let lastConnectErrorLog = 0;
      socket.on("connect", () => {
        if (typeof __DEV__ !== "undefined" && __DEV__) {
          const name = socket?.io.engine?.transport?.name;
          if (name) console.log(`[${kind} realtime] connected (${name})`);
        }
        emitJoin();
      });
      socket.io.on("reconnect", emitJoin);
      socket.on("connect_error", (err) => {
        const now = Date.now();
        if (now - lastConnectErrorLog < 12_000) return;
        lastConnectErrorLog = now;
        const e = err as Error & { description?: string; context?: unknown };
        const detail = [e.message, e.description].filter(Boolean).join(" — ");
        console.warn(`[${kind} realtime] connect_error`, detail || err);
      });

      socket.on(cfg.msgListen, (payload: unknown) => {
        const cid = conversationIdRef.current;
        if (
          cid &&
          isLiveSocketMessagePayload(payload) &&
          payload.conversationId === cid &&
          onLiveMessageRef.current
        ) {
          onLiveMessageRef.current(payload);
          const fl = flatListRefHolder.current?.current;
          if (fl) {
            /** One smooth scroll after layout; avoid repeated scrollToEnd + animated:false snaps (visible glitch). */
            const scrollSmooth = () => fl.scrollToEnd({ animated: true });
            InteractionManager.runAfterInteractions(() => {
              requestAnimationFrame(() => {
                requestAnimationFrame(scrollSmooth);
              });
            });
            return;
          }
          return;
        }
        const convId =
          payload && typeof payload === "object"
            ? (payload as { conversationId?: string }).conversationId
            : undefined;
        if (convId && cid && convId !== cid) return;
        void loadRef.current().then(() => {
          const fl = flatListRefHolder.current?.current;
          setTimeout(() => fl?.scrollToEnd({ animated: true }), 120);
        });
      });

      socket.on(cfg.readListen, (payload: { conversationId?: string } | undefined) => {
        const cid = conversationIdRef.current;
        if (payload?.conversationId && cid && payload.conversationId !== cid) return;
        void loadRef.current();
      });

      socket.on(cfg.typingListen, (data: { conversationId?: string; memberId?: string; active?: boolean }) => {
        if (data?.conversationId && data.conversationId !== conversationIdRef.current) return;
        if (!data?.memberId || data.memberId === memberIdRef.current) return;
        const mid = data.memberId;
        const active = Boolean(data.active);
        const prev = peerTimeoutsRef.current[mid];
        if (prev) clearTimeout(prev);
        if (active) {
          setTypingMemberIds((ids) => (ids.includes(mid) ? ids : [...ids, mid]));
          peerTimeoutsRef.current[mid] = setTimeout(() => {
            delete peerTimeoutsRef.current[mid];
            setTypingMemberIds((ids) => ids.filter((x) => x !== mid));
          }, CHAT_PEER_TYPING_INDICATOR_TTL_MS);
        } else {
          delete peerTimeoutsRef.current[mid];
          setTypingMemberIds((ids) => ids.filter((x) => x !== mid));
        }
      });

      socket.on(cfg.presence, (p: { conversationId?: string; memberId?: string; inChat?: boolean }) => {
        const cid = conversationIdRef.current;
        if (!cid || p.conversationId !== cid) return;
        const self = memberIdRef.current;
        const mid = p.memberId;
        if (!mid || mid === self) return;
        if (p.inChat) {
          setPeerPresenceIds((prev) => (prev.includes(mid) ? prev : [...prev, mid]));
        } else {
          setPeerPresenceIds((prev) => prev.filter((id) => id !== mid));
        }
      });

      socket.on(cfg.presenceSnapshot, (p: { conversationId?: string; memberIds?: string[] }) => {
        const cid = conversationIdRef.current;
        if (!cid || p.conversationId !== cid) return;
        const self = memberIdRef.current;
        const ids = (p.memberIds ?? []).filter((id) => id && id !== self);
        setPeerPresenceIds(ids);
      });
    })();

    return () => {
      cancelled = true;
      socketRef.current = null;
      Object.values(peerTimeoutsRef.current).forEach((t) => clearTimeout(t));
      peerTimeoutsRef.current = {};
      if (composerTypingRefreshRef.current) {
        clearInterval(composerTypingRefreshRef.current);
        composerTypingRefreshRef.current = null;
      }
      if (socket) {
        const leaveId = conversationIdRef.current;
        if (leaveId) {
          socket.emit(cfg.leave, leaveId);
        }
        if (emitJoinHandler) {
          socket.io.off("reconnect", emitJoinHandler);
        }
        socket.removeAllListeners();
        socket.disconnect();
      }
      setTypingMemberIds([]);
      setPeerPresenceIds([]);
    };
  }, [kind, conversationId, memberId, authLoading]);

  const emitTyping = useCallback(
    (active: boolean) => {
      const s = socketRef.current;
      if (!s?.connected || !conversationId) return;
      s.emit(RT[kind].typingEmit, { conversationId, active });
    },
    [kind, conversationId]
  );

  const clearComposerTypingRefresh = useCallback(() => {
    if (composerTypingRefreshRef.current) {
      clearInterval(composerTypingRefreshRef.current);
      composerTypingRefreshRef.current = null;
    }
  }, []);

  const clearComposerTypingSession = useCallback(() => {
    clearComposerTypingRefresh();
    emitTyping(false);
    setLocalComposerTypingActive(false);
  }, [emitTyping, clearComposerTypingRefresh]);

  const onComposerChange = useCallback((text: string, setMessage: (t: string) => void) => {
    setMessage(text);
  }, []);

  const stopComposerTyping = useCallback(() => {
    clearComposerTypingSession();
  }, [clearComposerTypingSession]);

  const onComposerFocusChange = useCallback(
    (focused: boolean) => {
      if (!conversationId) return;
      if (!focused) {
        clearComposerTypingSession();
        return;
      }
      const probe = isComposerFocusedProbeRef.current;
      if (probe && !probe()) return;
      clearComposerTypingRefresh();
      emitTyping(true);
      setLocalComposerTypingActive(true);
      composerTypingRefreshRef.current = setInterval(() => {
        const p = isComposerFocusedProbeRef.current;
        if (p && !p()) {
          clearComposerTypingRefresh();
          emitTyping(false);
          setLocalComposerTypingActive(false);
          return;
        }
        emitTyping(true);
      }, CHAT_COMPOSER_TYPING_REFRESH_MS);
    },
    [conversationId, emitTyping, clearComposerTypingSession, clearComposerTypingRefresh]
  );

  return {
    typingBanner,
    typingPeerIds,
    peerPresenceIds,
    localComposerTypingActive,
    onComposerChange,
    stopComposerTyping,
    onComposerFocusChange,
  };
}
