import { NextResponse } from "next/server";
import { prisma } from "database";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, db: "connected" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isConn = /P1001|ECONNREFUSED|connect|password|authentication/i.test(msg);
    return NextResponse.json(
      {
        ok: false,
        error: msg,
        hint: isConn
          ? "Check DATABASE_URL in .env. Ensure PostgreSQL is running and the database 'northwest_community' exists (run: pnpm exec prisma db push from packages/database)."
          : undefined,
      },
      { status: 500 }
    );
  }
}
