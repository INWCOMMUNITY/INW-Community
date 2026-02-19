import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const todos = await prisma.adminTodo.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(todos);
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json();
    const text = String(body?.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "Text required" }, { status: 400 });
    const count = await prisma.adminTodo.count();
    const todo = await prisma.adminTodo.create({
      data: { text, order: count },
    });
    return NextResponse.json(todo);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
