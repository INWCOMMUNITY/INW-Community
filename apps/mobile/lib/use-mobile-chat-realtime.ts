import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlatList } from "react-native";
import { io, type Socket } from "socket.io-client";
import { getToken } from "./api";
import { getDirectRealtimeUrl } from "./direct-realtime";
import { isLiveSocketMessagePayload, type LiveSocketMessagePayload } from "./chat-live-types";

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
  }
): {
  typingBanner: string | null;
  typingPeerIds: string[];
  peerPresenceIds: string[];
  onComposerChange: (text: string, setMessage: (t: string) => void) => void;
  stopComposerTyping: () => void;
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

  const [typingMemberIds, setTypingMemberIds] = useState<string[]>([]);
  const [peerPresenceIds, setPeerPresenceIds] = useState<string[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    /** Same ref as connect + reconnect handlers — needed for cleanup `off`. */
    let emitJoinHandler: (() => void) | null = null;

    void (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      socket = io(url, {
        transports: ["websocket", "polling"],
        auth: { token },
        reconnection: true,
        reconnectionAttempts: 8,
      });
      socketRef.current = socket;

      const emitJoin = () => {
        const cid = conversationIdRef.current;
        if (!cid || !socket?.connected) return;
        setPeerPresenceIds([]);
        socket.emit(cfg.join, cid, (err?: string) => {
          if (err) console.warn(`[${kind} realtime] join:`, err);
        });
      };
      emitJoinHandler = emitJoin;

      socket.on("connect", emitJoin);
      socket.io.on("reconnect", emitJoin);
      socket.on("connect_error", (err) => {
        console.warn(`[${kind} realtime] connect_error`, (err as Error)?.message ?? err);
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
          setTimeout(() => fl?.scrollToEnd({ animated: true }), 120);
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

      if (kind !== "group") {
        socket.on(cfg.readListen, (payload: { conversationId?: string } | undefined) => {
          const cid = conversationIdRef.current;
          if (payload?.conversationId && cid && payload.conversationId !== cid) return;
          void loadRef.current();
        });
      }

      socket.on(cfg.typingListen, (data: { memberId?: string; active?: boolean }) => {
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
          }, 2800);
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
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
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

  const onComposerChange = useCallback(
    (text: string, setMessage: (t: string) => void) => {
      setMessage(text);
      if (!conversationId) return;
      emitTyping(true);
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
      typingIdleRef.current = setTimeout(() => emitTyping(false), 2000);
    },
    [conversationId, emitTyping]
  );

  const stopComposerTyping = useCallback(() => {
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    emitTyping(false);
  }, [emitTyping]);

  return { typingBanner, typingPeerIds, peerPresenceIds, onComposerChange, stopComposerTyping };
}
