import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { z } from "zod";

const defaults = {
  notifyBadges: true,
  notifyMessages: true,
  notifyComments: true,
  notifyEvents: true,
  notifyGroupAdmin: true,
  notifyCommerce: true,
  notifySocial: true,
} as const;

const patchSchema = z
  .object({
    notifyBadges: z.boolean().optional(),
    notifyMessages: z.boolean().optional(),
    notifyComments: z.boolean().optional(),
    notifyEvents: z.boolean().optional(),
    notifyGroupAdmin: z.boolean().optional(),
    notifyCommerce: z.boolean().optional(),
    notifySocial: z.boolean().optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.memberNotificationPreferences.findUnique({
    where: { memberId: session.user.id },
  });
  if (!row) {
    return NextResponse.json(defaults);
  }
  return NextResponse.json({
    notifyBadges: row.notifyBadges,
    notifyMessages: row.notifyMessages,
    notifyComments: row.notifyComments,
    notifyEvents: row.notifyEvents,
    notifyGroupAdmin: row.notifyGroupAdmin,
    notifyCommerce: row.notifyCommerce,
    notifySocial: row.notifySocial,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await prisma.memberNotificationPreferences.upsert({
    where: { memberId: session.user.id },
    create: {
      memberId: session.user.id,
      ...defaults,
      ...body,
    },
    update: body,
  });

  return NextResponse.json({
    notifyBadges: updated.notifyBadges,
    notifyMessages: updated.notifyMessages,
    notifyComments: updated.notifyComments,
    notifyEvents: updated.notifyEvents,
    notifyGroupAdmin: updated.notifyGroupAdmin,
    notifyCommerce: updated.notifyCommerce,
    notifySocial: updated.notifySocial,
  });
}
