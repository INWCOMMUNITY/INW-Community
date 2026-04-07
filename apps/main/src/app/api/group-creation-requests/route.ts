import { NextRequest, NextResponse } from "next/server";
import { prisma } from "database";
import { getSessionForApi } from "@/lib/mobile-auth";
import { groupCreationPayloadSchema } from "@/lib/create-group-core";
import { requireVerifiedActiveMember } from "@/lib/require-verified-member";
import { z } from "zod";

export async function POST(req: NextRequest) {
  const session = await getSessionForApi(req);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const verified = await requireVerifiedActiveMember(session.user.id);
  if (!verified.ok) return verified.response;

  const member = await prisma.member.findUnique({
    where: { id: session.user.id },
    select: { privacyLevel: true },
  });
  if (member?.privacyLevel === "completely_private") {
    return NextResponse.json({ error: "Cannot request groups with completely private account" }, { status: 403 });
  }

  const existingPending = await prisma.groupCreationRequest.findFirst({
    where: { requesterMemberId: session.user.id, status: "pending" },
    select: { id: true },
  });
  if (existingPending) {
    return NextResponse.json(
      { error: "You already have a pending group request. Wait for review or withdraw it before submitting another." },
      { status: 400 }
    );
  }

  try {
    const body = await req.json();
    const data = groupCreationPayloadSchema.parse(body);

    const row = await prisma.groupCreationRequest.create({
      data: {
        requesterMemberId: session.user.id,
        name: data.name,
        description: data.description ?? null,
        category: data.category ?? null,
        coverImageUrl: data.coverImageUrl ?? null,
        rules: data.rules ?? null,
        allowBusinessPosts: data.allowBusinessPosts ?? false,
        status: "pending",
      },
    });

    return NextResponse.json({
      request: {
        id: row.id,
        status: row.status,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
      },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.flatten() }, { status: 400 });
    }
    console.error("[POST /api/group-creation-requests]", e);
    return NextResponse.json({ error: "Failed to submit request" }, { status: 500 });
  }
}
