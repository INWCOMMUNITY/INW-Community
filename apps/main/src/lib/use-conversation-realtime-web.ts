"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { isLiveSocketMessagePayload, type LiveSocketMessagePayload } from "@/lib/chat-live-types";

export type { LiveSocketMessagePayload };

export type ConversationRealtimeKind = "direct" | "group" | "resale";

type Tab = "direct" | "groups" | "resale";

function isPrivateOrLocalHost(h: string): boolean {
  if (h === "localhost" || h === "127.0.0.1") return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return h.endsWith(".local");
}

/**
 * Realtime URL for the browser. Never use 127.0.0.1/localhost from env when the page is opened
 * at a LAN IP (Expo phone, another PC) — the socket would target the wrong machine.
 */
function getBrowserRealtimeUrl(): string | null {
  if (typeof window === "undefined") return null;
  const h = window.location.hostname;
  const raw = process.env.NEXT_PUBLIC_REALTIME_URL?.trim().replace(/\/+$/, "");

  if (raw) {
    try {
      const url = new URL(raw.startsWith("http") ? raw : `http://${raw}`);
      const loopback =
        url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]";
      const port = url.port || "3007";
      if (
        loopback &&
        h !== "127.0.0.1" &&
        h !== "localhost" &&
        isPrivateOrLocalHost(h)
      ) {
        return `${url.protocol}//${h}:${port}`;
      }
    } catch {
      /* use raw */
    }
    return raw;
  }

  if (process.env.NODE_ENV === "development" || isPrivateOrLocalHost(h)) {
    return `http://${h}:3007`;
  }

  return null;
}

function joinEvent(kind: ConversationRealtimeKind): string {
  switch (kind) {
    case "direct":
      return "join_direct";
    case "group":
      return "join_group";
    case "resale":
      return "join_resale";
  }
}

function leaveEvent(kind: ConversationRealtimeKind): string {
  switch (kind) {
    case "direct":
      return "leave_direct";
    case "group":
      return "leave_group";
    case "resale":
      return "leave_resale";
  }
}

function typingEmit(kind: ConversationRealtimeKind): string {
  switch (kind) {
    case "direct":
      return "direct_typing";
    case "group":
      return "group_typing";
    case "resale":
      return "resale_typing";
  }
}

function activeThreadFromTab(
  tab: Tab,
  directId: string | null,
  groupId: string | null,
  resaleId: string | null
): { kind: ConversationRealtimeKind; id: string } | null {
  if (tab === "direct" && directId) return { kind: "direct", id: directId };
  if (tab === "groups" && groupId) return { kind: "group", id: groupId };
  if (tab === "resale" && resaleId) return { kind: "resale", id: resaleId };
  return null;
}

/**
 * Single Socket.IO connection for the messages page: joins one room at a time as the user switches threads.
 */
export function useMessagesPageRealtime(options: {
  tab: Tab;
  directId: string | null;
  groupId: string | null;
  resaleId: string | null;
  sessionUserId: string | undefined;
  refreshDirect: () => void;
  refreshGroup: () => void;
  refreshResale: () => void;
  /** Refetch conversation lists (sidebar) when any thread gets activity */
  refreshSidebar?: () => void;
  /** Append incoming message instantly when server sends a live payload (same thread only). */
  applyLiveDirect?: (p: LiveSocketMessagePayload) => void;
  applyLiveGroup?: (p: LiveSocketMessagePayload) => void;
  applyLiveResale?: (p: LiveSocketMessagePayload) => void;
}): {
  typingPeerIds: string[];
  /** Member IDs (other than you) currently viewing the open thread — for avatars next to Seen. */
  peerPresenceIds: string[];
  onComposerTyping: () => void;
  stopComposerTyping: () => void;
} {
  const {
    tab,
    directId,
    groupId,
    resaleId,
    sessionUserId,
    refreshDirect,
    refreshGroup,
    refreshResale,
    refreshSidebar,
    applyLiveDirect,
    applyLiveGroup,
    applyLiveResale,
  } = options;

  const activeThread = useMemo(
    () => activeThreadFromTab(tab, directId, groupId, resaleId),
    [tab, directId, groupId, resaleId]
  );

  const [typingMemberIds, setTypingMemberIds] = useState<string[]>([]);
  const [peerPresenceIds, setPeerPresenceIds] = useState<string[]>([]);
  /** Bumps on connect/reconnect so we re-run room sync after the socket is ready. */
  const [socketEpoch, setSocketEpoch] = useState(0);
  const socketRef = useRef<Socket | null>(null);
  const joinedRef = useRef<{ kind: ConversationRealtimeKind; id: string } | null>(null);
  const activeThreadRef = useRef(activeThread);
  activeThreadRef.current = activeThread;

  const refreshDirectRef = useRef(refreshDirect);
  const refreshGroupRef = useRef(refreshGroup);
  const refreshResaleRef = useRef(refreshResale);
  const refreshSidebarRef = useRef(refreshSidebar);
  refreshDirectRef.current = refreshDirect;
  refreshGroupRef.current = refreshGroup;
  refreshResaleRef.current = refreshResale;
  refreshSidebarRef.current = refreshSidebar;

  const applyLiveDirectRef = useRef(applyLiveDirect);
  const applyLiveGroupRef = useRef(applyLiveGroup);
  const applyLiveResaleRef = useRef(applyLiveResale);
  applyLiveDirectRef.current = applyLiveDirect;
  applyLiveGroupRef.current = applyLiveGroup;
  applyLiveResaleRef.current = applyLiveResale;

  const directIdRef = useRef(directId);
  const groupIdRef = useRef(groupId);
  const resaleIdRef = useRef(resaleId);
  directIdRef.current = directId;
  groupIdRef.current = groupId;
  resaleIdRef.current = resaleId;

  const userIdRef = useRef(sessionUserId);
  userIdRef.current = sessionUserId;

  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const typingPeerIds = useMemo(() => {
    const self = sessionUserId;
    return typingMemberIds.filter((id) => id && id !== self);
  }, [typingMemberIds, sessionUserId]);

  useEffect(() => {
    setPeerPresenceIds([]);
  }, [tab, directId, groupId, resaleId]);

  const syncRoom = useCallback((sock: Socket) => {
    const cur = activeThreadRef.current;
    const prev = joinedRef.current;
    if (cur && prev && prev.kind === cur.kind && prev.id === cur.id && sock.connected) {
      return;
    }
    if (prev && (!cur || prev.kind !== cur.kind || prev.id !== cur.id)) {
      sock.emit(leaveEvent(prev.kind), prev.id);
      joinedRef.current = null;
    }
    if (cur && sock.connected) {
      sock.emit(joinEvent(cur.kind), cur.id, (err?: string) => {
        if (err) console.warn("[messages realtime] join failed:", err);
      });
      joinedRef.current = cur;
    }
    setTypingMemberIds([]);
    Object.values(peerTimeoutsRef.current).forEach((t) => clearTimeout(t));
    peerTimeoutsRef.current = {};
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    const base = getBrowserRealtimeUrl();
    if (!base) return;

    let cancelled = false;
    let socket: Socket | null = null;
    let managerReconnectHandler: (() => void) | null = null;

    void (async () => {
      const res = await fetch("/api/realtime/token", { credentials: "include" });
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { token?: string };
      if (!data.token || cancelled) return;

      socket = io(base, {
        transports: ["websocket", "polling"],
        auth: { token: data.token },
        reconnection: true,
      });
      socketRef.current = socket;

      const onTyping = (payload: { memberId?: string; active?: boolean }) => {
        if (!payload?.memberId || payload.memberId === userIdRef.current) return;
        const mid = payload.memberId;
        const active = Boolean(payload.active);
        const prevT = peerTimeoutsRef.current[mid];
        if (prevT) clearTimeout(prevT);
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
      };

      const applyPresenceDelta = (
        kind: ConversationRealtimeKind,
        p: { conversationId?: string; memberId?: string; inChat?: boolean }
      ) => {
        const cur = activeThreadRef.current;
        if (!cur || cur.kind !== kind || p.conversationId !== cur.id) return;
        const self = userIdRef.current;
        const mid = p.memberId;
        if (!mid || mid === self) return;
        if (p.inChat) {
          setPeerPresenceIds((prev) => (prev.includes(mid) ? prev : [...prev, mid]));
        } else {
          setPeerPresenceIds((prev) => prev.filter((id) => id !== mid));
        }
      };

      const applyPresenceSnapshot = (
        kind: ConversationRealtimeKind,
        p: { conversationId?: string; memberIds?: string[] }
      ) => {
        const cur = activeThreadRef.current;
        if (!cur || cur.kind !== kind || p.conversationId !== cur.id) return;
        const self = userIdRef.current;
        const ids = (p.memberIds ?? []).filter((id) => id && id !== self);
        setPeerPresenceIds(ids);
      };

      const onConnect = () => {
        setPeerPresenceIds([]);
        setSocketEpoch((n) => n + 1);
        syncRoom(socket!);
      };
      managerReconnectHandler = onConnect;
      socket.on("connect", onConnect);
      socket.io.on("reconnect", onConnect);
      socket.on("connect_error", (err) => {
        console.warn("[messages realtime] connect_error", err?.message ?? err);
      });

      const onDirectMessage = (p: unknown) => {
        refreshSidebarRef.current?.();
        const cid = directIdRef.current;
        if (
          cid &&
          isLiveSocketMessagePayload(p) &&
          p.conversationId === cid &&
          applyLiveDirectRef.current
        ) {
          applyLiveDirectRef.current(p);
          return;
        }
        const convId =
          p && typeof p === "object" && typeof (p as { conversationId?: string }).conversationId === "string"
            ? (p as { conversationId: string }).conversationId
            : undefined;
        if (!convId || convId === cid) {
          refreshDirectRef.current();
        }
      };
      const onGroupMessage = (p: unknown) => {
        refreshSidebarRef.current?.();
        const gid = groupIdRef.current;
        if (
          gid &&
          isLiveSocketMessagePayload(p) &&
          p.conversationId === gid &&
          applyLiveGroupRef.current
        ) {
          applyLiveGroupRef.current(p);
          return;
        }
        const convId =
          p && typeof p === "object" && typeof (p as { conversationId?: string }).conversationId === "string"
            ? (p as { conversationId: string }).conversationId
            : undefined;
        if (!convId || convId === gid) {
          refreshGroupRef.current();
        }
      };
      const onResaleMessage = (p: unknown) => {
        refreshSidebarRef.current?.();
        const rid = resaleIdRef.current;
        if (
          rid &&
          isLiveSocketMessagePayload(p) &&
          p.conversationId === rid &&
          applyLiveResaleRef.current
        ) {
          applyLiveResaleRef.current(p);
          return;
        }
        const convId =
          p && typeof p === "object" && typeof (p as { conversationId?: string }).conversationId === "string"
            ? (p as { conversationId: string }).conversationId
            : undefined;
        if (!convId || convId === rid) {
          refreshResaleRef.current();
        }
      };

      const onDirectRead = (p: { conversationId?: string }) => {
        refreshSidebarRef.current?.();
        if (!p?.conversationId || p.conversationId === directIdRef.current) {
          refreshDirectRef.current();
        }
      };
      const onGroupRead = (p: { conversationId?: string }) => {
        refreshSidebarRef.current?.();
        if (!p?.conversationId || p.conversationId === groupIdRef.current) {
          refreshGroupRef.current();
        }
      };
      const onResaleRead = (p: { conversationId?: string }) => {
        refreshSidebarRef.current?.();
        if (!p?.conversationId || p.conversationId === resaleIdRef.current) {
          refreshResaleRef.current();
        }
      };

      socket.on("direct:message", onDirectMessage);
      socket.on("group:message", onGroupMessage);
      socket.on("resale:message", onResaleMessage);

      socket.on("direct:read", onDirectRead);
      socket.on("group:read", onGroupRead);
      socket.on("resale:read", onResaleRead);

      socket.on("direct:typing", onTyping);
      socket.on("group:typing", onTyping);
      socket.on("resale:typing", onTyping);

      socket.on("direct:presence", (p: { conversationId?: string; memberId?: string; inChat?: boolean }) => {
        applyPresenceDelta("direct", p);
      });
      socket.on("direct:presence_snapshot", (p: { conversationId?: string; memberIds?: string[] }) => {
        applyPresenceSnapshot("direct", p);
      });
      socket.on("group:presence", (p: { conversationId?: string; memberId?: string; inChat?: boolean }) => {
        applyPresenceDelta("group", p);
      });
      socket.on("group:presence_snapshot", (p: { conversationId?: string; memberIds?: string[] }) => {
        applyPresenceSnapshot("group", p);
      });
      socket.on("resale:presence", (p: { conversationId?: string; memberId?: string; inChat?: boolean }) => {
        applyPresenceDelta("resale", p);
      });
      socket.on("resale:presence_snapshot", (p: { conversationId?: string; memberIds?: string[] }) => {
        applyPresenceSnapshot("resale", p);
      });

      if (socket.connected) {
        onConnect();
      }
    })();

    return () => {
      cancelled = true;
      socketRef.current = null;
      joinedRef.current = null;
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
      Object.values(peerTimeoutsRef.current).forEach((t) => clearTimeout(t));
      peerTimeoutsRef.current = {};
      if (socket) {
        if (managerReconnectHandler) {
          socket.io.off("reconnect", managerReconnectHandler);
        }
        socket.removeAllListeners();
        socket.disconnect();
      }
      setTypingMemberIds([]);
      setPeerPresenceIds([]);
    };
  }, [sessionUserId, syncRoom]);

  useEffect(() => {
    const sock = socketRef.current;
    if (sock?.connected) {
      syncRoom(sock);
    }
  }, [activeThread, syncRoom, socketEpoch]);

  const notifyTyping = useCallback(
    (active: boolean) => {
      const sock = socketRef.current;
      const cur = activeThreadRef.current;
      if (!sock?.connected || !cur) return;
      sock.emit(typingEmit(cur.kind), { conversationId: cur.id, active });
    },
    []
  );

  const onComposerTyping = useCallback(() => {
    notifyTyping(true);
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    typingIdleRef.current = setTimeout(() => notifyTyping(false), 2000);
  }, [notifyTyping]);

  const stopComposerTyping = useCallback(() => {
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    notifyTyping(false);
  }, [notifyTyping]);

  return { typingPeerIds, peerPresenceIds, onComposerTyping, stopComposerTyping };
}
