import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body = await req.json();
    const completed = body?.completed;
    if (typeof completed !== "boolean") {
      return NextResponse.json({ error: "completed required" }, { status: 400 });
    }
    const todo = await prisma.adminTodo.update({
      where: { id },
      data: { completed },
    });
    return NextResponse.json(todo);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await prisma.adminTodo.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
