import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { dismissAdminTodoQueue, isAdminTodoQueueKey } from "@/lib/admin-todo-queue";

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json();
    const key = String(body?.key ?? "");
    if (!isAdminTodoQueueKey(key)) {
      return NextResponse.json({ error: "Invalid key" }, { status: 400 });
    }
    await dismissAdminTodoQueue(key);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
