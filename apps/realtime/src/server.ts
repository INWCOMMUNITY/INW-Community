import "./load-root-env";
import http from "http";
import express from "express";
import cors from "cors";
import { Server, type Socket } from "socket.io";

type ChatSpace = "direct" | "group" | "resale";

/** Tell others someone opened the thread; send joiner a snapshot of peers already viewing. */
async function afterJoinPresence(
  io: Server,
  socket: Socket,
  space: ChatSpace,
  conversationId: string,
  memberId: string
): Promise<void> {
  const room = `${space}:${conversationId}`;
  socket.to(room).emit(`${space}:presence`, { conversationId, memberId, inChat: true });
  try {
    const sockets = await io.in(room).fetchSockets();
    const peerIds: string[] = [];
    const seen = new Set<string>();
    for (const s of sockets) {
      if (s.id === socket.id) continue;
      const m = s.data?.memberId as string | undefined;
      if (m && !seen.has(m)) {
        seen.add(m);
        peerIds.push(m);
      }
    }
    socket.emit(`${space}:presence_snapshot`, { conversationId, memberIds: peerIds });
  } catch {
    socket.emit(`${space}:presence_snapshot`, { conversationId, memberIds: [] });
  }
}
import { prisma } from "database";
import { verifySocketAuthToken } from "./auth";

/** Production: REALTIME_PUBLISH_SECRET only. Dev: falls back to NEXTAUTH_SECRET so local chat works without extra env. */
const PUBLISH_SECRET =
  (process.env.REALTIME_PUBLISH_SECRET ?? "").trim() ||
  (process.env.NODE_ENV === "production" ? "" : (process.env.NEXTAUTH_SECRET ?? "").trim());
const METRICS_SECRET = process.env.REALTIME_METRICS_SECRET ?? "";

const TYPING_WINDOW_MS = 12_000;
const TYPING_MAX_PER_WINDOW = 48;
const typingBudget = new Map<string, { count: number; resetAt: number }>();
let publishCount = 0;
let typingThrottledCount = 0;

function allowTypingEmit(socketId: string): boolean {
  const now = Date.now();
  let b = typingBudget.get(socketId);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + TYPING_WINDOW_MS };
    typingBudget.set(socketId, b);
  }
  b.count += 1;
  if (b.count > TYPING_MAX_PER_WINDOW) {
    typingThrottledCount += 1;
    return false;
  }
  return true;
}

function parseCorsOrigins(): string[] {
  const raw = process.env.REALTIME_CORS_ORIGINS;
  if (raw?.trim()) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8082",
    "http://127.0.0.1:8082",
    "https://www.inwcommunity.com",
  ];
}

const allowedOrigins = parseCorsOrigins();

function isVercelPreviewOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && u.hostname.endsWith(".vercel.app") && u.hostname.length > ".vercel.app".length;
  } catch {
    return false;
  }
}

/** Production: allow NWC sites + Vercel previews + opaque "null" origins (some native WebViews). Native apps often send no Origin — handled by !origin above. */
function corsAllowsOrigin(origin: string | undefined): boolean {
  if (!origin || origin === "null") return true;
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV !== "production") return true;
  if (isVercelPreviewOrigin(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*inwcommunity\.com$/i.test(origin)) return true;
  if (/^https:\/\/([a-z0-9-]+\.)*northwestcommunity\.com$/i.test(origin)) return true;
  return false;
}

const app = express();
app.use(express.json({ limit: "256kb" }));

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (corsAllowsOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
});

io.use(async (socket, next) => {
  try {
    const token = typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : "";
    if (!token) {
      next(new Error("auth required"));
      return;
    }
    const mid = await verifySocketAuthToken(token);
    if (!mid) {
      next(new Error("invalid token"));
      return;
    }
    socket.data.memberId = mid;
    console.log(`[realtime] connect member=${mid} socket=${socket.id}`);
    next();
  } catch {
    next(new Error("auth failed"));
  }
});

io.on("connection", (socket) => {
  const memberId = socket.data.memberId as string;

  socket.on("disconnect", (reason) => {
    console.log(`[realtime] disconnect socket=${socket.id} reason=${reason}`);
    typingBudget.delete(socket.id);
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      if (room.startsWith("direct:")) {
        const cid = room.slice("direct:".length);
        io.to(room).emit("direct:presence", { conversationId: cid, memberId, inChat: false });
      } else if (room.startsWith("group:")) {
        const cid = room.slice("group:".length);
        io.to(room).emit("group:presence", { conversationId: cid, memberId, inChat: false });
      } else if (room.startsWith("resale:")) {
        const cid = room.slice("resale:".length);
        io.to(room).emit("resale:presence", { conversationId: cid, memberId, inChat: false });
      }
    }
  });

  socket.on("join_direct", async (conversationId: unknown, ack?: (err?: string) => void) => {
    if (typeof conversationId !== "string" || !conversationId) {
      ack?.("invalid conversation");
      return;
    }
    try {
      const conv = await prisma.directConversation.findUnique({
        where: { id: conversationId },
        select: { memberAId: true, memberBId: true },
      });
      if (!conv || (conv.memberAId !== memberId && conv.memberBId !== memberId)) {
        ack?.("forbidden");
        return;
      }
      await socket.join(`direct:${conversationId}`);
      await afterJoinPresence(io, socket, "direct", conversationId, memberId);
      ack?.();
    } catch {
      ack?.("server error");
    }
  });

  socket.on("leave_direct", (conversationId: unknown) => {
    if (typeof conversationId === "string" && conversationId) {
      const room = `direct:${conversationId}`;
      void Promise.resolve(socket.leave(room)).then(() => {
        io.to(room).emit("direct:presence", { conversationId, memberId, inChat: false });
      });
    }
  });

  const emitTyping =
    (roomPrefix: "direct" | "group" | "resale", eventName: string) => (body: unknown) => {
      if (!body || typeof body !== "object") return;
      const o = body as { conversationId?: string; active?: boolean };
      if (typeof o.conversationId !== "string" || !o.conversationId) return;
      if (!allowTypingEmit(socket.id)) return;
      const active = Boolean(o.active);
      socket.to(`${roomPrefix}:${o.conversationId}`).emit(eventName, { memberId, active });
    };

  socket.on("direct_typing", emitTyping("direct", "direct:typing"));
  socket.on("group_typing", emitTyping("group", "group:typing"));
  socket.on("resale_typing", emitTyping("resale", "resale:typing"));

  socket.on("join_group", async (conversationId: unknown, ack?: (err?: string) => void) => {
    if (typeof conversationId !== "string" || !conversationId) {
      ack?.("invalid conversation");
      return;
    }
    try {
      const membership = await prisma.groupConversationMember.findUnique({
        where: { conversationId_memberId: { conversationId, memberId } },
      });
      if (!membership) {
        ack?.("forbidden");
        return;
      }
      await socket.join(`group:${conversationId}`);
      await afterJoinPresence(io, socket, "group", conversationId, memberId);
      ack?.();
    } catch {
      ack?.("server error");
    }
  });

  socket.on("leave_group", (conversationId: unknown) => {
    if (typeof conversationId === "string" && conversationId) {
      const room = `group:${conversationId}`;
      void Promise.resolve(socket.leave(room)).then(() => {
        io.to(room).emit("group:presence", { conversationId, memberId, inChat: false });
      });
    }
  });

  socket.on("join_resale", async (conversationId: unknown, ack?: (err?: string) => void) => {
    if (typeof conversationId !== "string" || !conversationId) {
      ack?.("invalid conversation");
      return;
    }
    try {
      const conv = await prisma.resaleConversation.findUnique({
        where: { id: conversationId },
        select: { buyerId: true, sellerId: true },
      });
      if (!conv || (conv.buyerId !== memberId && conv.sellerId !== memberId)) {
        ack?.("forbidden");
        return;
      }
      await socket.join(`resale:${conversationId}`);
      await afterJoinPresence(io, socket, "resale", conversationId, memberId);
      ack?.();
    } catch {
      ack?.("server error");
    }
  });

  socket.on("leave_resale", (conversationId: unknown) => {
    if (typeof conversationId === "string" && conversationId) {
      const room = `resale:${conversationId}`;
      void Promise.resolve(socket.leave(room)).then(() => {
        io.to(room).emit("resale:presence", { conversationId, memberId, inChat: false });
      });
    }
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptimeSec: Math.floor(process.uptime()) });
});

app.get("/internal/metrics", (req, res) => {
  if (METRICS_SECRET) {
    if (req.headers.authorization !== `Bearer ${METRICS_SECRET}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
  }
  res.json({
    connections: io.engine.clientsCount,
    publishes: publishCount,
    typingThrottled: typingThrottledCount,
  });
});

app.post("/internal/publish", (req, res) => {
  if (!PUBLISH_SECRET) {
    res.status(503).json({ error: "Realtime publish not configured" });
    return;
  }
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${PUBLISH_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const body = req.body as {
    type?: string;
    conversationId?: string;
    payload?: unknown;
  };
  const cid = body.conversationId;
  if (typeof cid !== "string" || !cid) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }

  publishCount += 1;

  const route: [string, string][] = [
    ["direct:message", `direct:${cid}`],
    ["group:message", `group:${cid}`],
    ["resale:message", `resale:${cid}`],
    ["direct:read", `direct:${cid}`],
    ["group:read", `group:${cid}`],
    ["resale:read", `resale:${cid}`],
  ];
  const eventByType: Record<string, string> = {
    "direct:message": "direct:message",
    "group:message": "group:message",
    "resale:message": "resale:message",
    "direct:read": "direct:read",
    "group:read": "group:read",
    "resale:read": "resale:read",
  };
  const t = body.type;
  if (!t || !eventByType[t]) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const room = route.find(([k]) => k === t)?.[1];
  if (!room) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const mergedPayload =
    typeof body.payload === "object" && body.payload !== null && !Array.isArray(body.payload)
      ? { conversationId: cid, ...body.payload }
      : { conversationId: cid };
  io.to(room).emit(eventByType[t], mergedPayload);
  res.json({ ok: true });
});

const PORT = Number(process.env.PORT ?? process.env.REALTIME_PORT ?? 3007);

async function bootstrap(): Promise<void> {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (redisUrl) {
    try {
      const { createClient } = await import("redis");
      const { createAdapter } = await import("@socket.io/redis-adapter");
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();
      pubClient.on("error", (err: Error) => console.error("[realtime] redis pub error", err.message));
      subClient.on("error", (err: Error) => console.error("[realtime] redis sub error", err.message));
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      console.log("[realtime] Socket.IO Redis adapter enabled");
    } catch (e) {
      console.warn("[realtime] Redis adapter failed, single-node mode:", (e as Error).message);
    }
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[realtime] listening on ${PORT}`);
  });
}

void bootstrap();
