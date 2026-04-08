import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { getAdminTodoQueueItems } from "@/lib/admin-todo-queue";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const items = await getAdminTodoQueueItems();
  return NextResponse.json(items);
}
