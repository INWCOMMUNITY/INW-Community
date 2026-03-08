import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const bodySchema = z.object({
  token: z.string().min(1),
  deviceId: z.string().optional(),
});

/** Register or update the current device's Expo push token for the logged-in member. */
export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let data: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    data = bodySchema.parse(body);
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.errors[0]?.message : "Invalid input";
    return NextResponse.json({ error: String(msg) }, { status: 400 });
  }

  const { token, deviceId } = data;
  if (!token.startsWith("ExponentPushToken[") || !token.endsWith("]")) {
    return NextResponse.json({ error: "Invalid Expo push token format" }, { status: 400 });
  }

  await prisma.memberPushToken.upsert({
    where: { token },
    create: { memberId: session.user.id, token, deviceId: deviceId ?? null },
    update: { memberId: session.user.id, deviceId: deviceId ?? undefined },
  });

  return NextResponse.json({ ok: true });
}
