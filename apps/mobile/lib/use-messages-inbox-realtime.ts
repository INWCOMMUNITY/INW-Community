import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { io, type Socket } from "socket.io-client";
import { apiGet, getToken } from "./api";
import { getDirectRealtimeUrl } from "./direct-realtime";
import {
  isLiveResaleOfferUpdatePayload,
  isLiveSocketMessagePayload,
  type LiveResaleOfferUpdatePayload,
  type LiveSocketMessagePayload,
} from "./chat-live-types";

export type InboxTab = "direct" | "resale" | "groups";

type ChatChannel = "direct" | "group" | "resale";

const JOIN: Record<ChatChannel, string> = {
  direct: "join_direct",
  group: "join_group",
  resale: "join_resale",
};
const LEAVE: Record<ChatChannel, string> = {
  direct: "leave_direct",
  group: "leave_group",
  resale: "leave_resale",
};

function tabToChannel(tab: InboxTab): ChatChannel {
  if (tab === "groups") return "group";
  if (tab === "resale") return "resale";
  return "direct";
}

/** Live messages + read on the inbox list. Typing is only shown inside an open thread, not on row previews. */
export function useMessagesInboxRealtime(options: {
  tab: InboxTab;
  conversationIds: string[];
  authLoading: boolean;
  memberId: string | undefined;
  /** When false, socket is disconnected (e.g. logged out). */
  enabled: boolean;
  onLiveMessage: (channel: ChatChannel, p: LiveSocketMessagePayload) => void;
  onLiveRead: (channel: ChatChannel, conversationId: string) => void;
  /** Refetch lists when activity references a conversation we are not showing (e.g. new thread). */
  onRefreshLists: () => void;
  /** Resale offer card changed in a joined thread (same `messageId`, new status). */
  onLiveResaleOfferUpdate?: (p: LiveResaleOfferUpdatePayload) => void;
}): void {
  const {
    tab,
    conversationIds,
    authLoading,
    memberId,
    enabled,
    onLiveMessage,
    onLiveRead,
    onRefreshLists,
    onLiveResaleOfferUpdate,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const joinedRef = useRef<{ kind: ChatChannel; id: string }[]>([]);
  const tabRef = useRef(tab);
  const idsRef = useRef(conversationIds);
  const onLiveMessageRef = useRef(onLiveMessage);
  const onLiveReadRef = useRef(onLiveRead);
  const onRefreshListsRef = useRef(onRefreshLists);
  const onLiveResaleOfferUpdateRef = useRef(onLiveResaleOfferUpdate);

  tabRef.current = tab;
  idsRef.current = conversationIds;
  onLiveMessageRef.current = onLiveMessage;
  onLiveReadRef.current = onLiveRead;
  onRefreshListsRef.current = onRefreshLists;
  onLiveResaleOfferUpdateRef.current = onLiveResaleOfferUpdate;

  useEffect(() => {
    if (!enabled || authLoading) return;
    const url = getDirectRealtimeUrl();
    if (!url || !memberId) return;

    let cancelled = false;
    let socket: Socket | null = null;
    let managerReconnectHandler: (() => void) | null = null;

    void (async () => {
      const token = await getToken();
      const trimmed = token?.trim();
      if (!trimmed || cancelled) return;
      let socketAuth = trimmed;
      try {
        const { token: rt } = await apiGet<{ token: string }>("/api/realtime/token");
        if (typeof rt === "string" && rt.length > 0) socketAuth = rt;
      } catch {
        /* fall back */
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

      const onMessage = (channel: ChatChannel, p: unknown) => {
        if (!isLiveSocketMessagePayload(p)) return;
        const t = tabRef.current;
        const ok =
          (channel === "direct" && t === "direct") ||
          (channel === "group" && t === "groups") ||
          (channel === "resale" && t === "resale");
        if (!ok) return;
        if (!idsRef.current.includes(p.conversationId)) {
          onRefreshListsRef.current();
          return;
        }
        onLiveMessageRef.current(channel, p);
      };

      const onRead = (channel: ChatChannel, p: { conversationId?: string } | undefined) => {
        const cid = p?.conversationId;
        if (!cid) return;
        const t = tabRef.current;
        const ok =
          (channel === "direct" && t === "direct") ||
          (channel === "group" && t === "groups") ||
          (channel === "resale" && t === "resale");
        if (!ok || !idsRef.current.includes(cid)) return;
        onLiveReadRef.current(channel, cid);
      };

      socket.on("direct:message", (payload: unknown) => onMessage("direct", payload));
      socket.on("group:message", (payload: unknown) => onMessage("group", payload));
      socket.on("resale:message", (payload: unknown) => onMessage("resale", payload));
      socket.on("direct:read", (payload: unknown) => onRead("direct", payload as { conversationId?: string }));
      socket.on("group:read", (payload: unknown) => onRead("group", payload as { conversationId?: string }));
      socket.on("resale:read", (payload: unknown) => onRead("resale", payload as { conversationId?: string }));

      const onResaleOfferUpdate = (payload: unknown) => {
        if (!isLiveResaleOfferUpdatePayload(payload)) return;
        const t = tabRef.current;
        if (t !== "resale") return;
        if (!idsRef.current.includes(payload.conversationId)) {
          onRefreshListsRef.current();
          return;
        }
        onLiveResaleOfferUpdateRef.current?.(payload);
      };
      socket.on("resale:offer_update", onResaleOfferUpdate);

      const syncJoins = () => {
        const sock = socketRef.current;
        if (!sock?.connected) return;
        for (const r of joinedRef.current) {
          sock.emit(LEAVE[r.kind], r.id);
        }
        joinedRef.current = [];
        const kind = tabToChannel(tabRef.current);
        for (const id of idsRef.current) {
          sock.emit(JOIN[kind], id, (err?: string) => {
            if (err) return;
            joinedRef.current.push({ kind, id });
          });
        }
      };

      const onConnect = () => {
        syncJoins();
      };
      managerReconnectHandler = onConnect;
      socket.on("connect", onConnect);
      socket.io.on("reconnect", onConnect);
      socket.on("connect_error", (err: Error) => {
        console.warn("[inbox realtime] connect_error", err?.message ?? err);
      });

      if (socket.connected) {
        onConnect();
      }
    })();

    return () => {
      cancelled = true;
      socketRef.current = null;
      if (socket) {
        for (const r of joinedRef.current) {
          socket.emit(LEAVE[r.kind], r.id);
        }
        joinedRef.current = [];
        if (managerReconnectHandler) {
          socket.io.off("reconnect", managerReconnectHandler);
        }
        socket.removeAllListeners();
        socket.disconnect();
      }
    };
  }, [enabled, authLoading, memberId]);

  useEffect(() => {
    const sock = socketRef.current;
    if (!sock?.connected || !enabled || authLoading) return;
    for (const r of joinedRef.current) {
      sock.emit(LEAVE[r.kind], r.id);
    }
    joinedRef.current = [];
    const kind = tabToChannel(tab);
    for (const id of conversationIds) {
      sock.emit(JOIN[kind], id, (err?: string) => {
        if (err) return;
        joinedRef.current.push({ kind, id });
      });
    }
  }, [tab, conversationIds, enabled, authLoading]);
}
