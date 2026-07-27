import { NextRequest, NextResponse } from "next/server";
import { getSessionForApi } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const session = await getSessionForApi(_req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);

      // TODO: Subscribe to new-post events (e.g. via Redis pub/sub or DB polling)
      // and push `data: {"type":"new_post","postId":"..."}` events to connected clients.
      // Example:
      //   const data = JSON.stringify({ type: "new_post", postId: "abc123" });
      //   controller.enqueue(encoder.encode(`data: ${data}\n\n`));

      _req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // stream already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
