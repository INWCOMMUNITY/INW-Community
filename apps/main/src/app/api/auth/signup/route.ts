import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";
import { awardMemberSignupBadges, awardSpreadingTheWordBadge } from "@/lib/badge-award";

const schema = z.object({
  email: z.string().email("Please enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(128),
  firstName: z.string().min(1, "First name is required."),
  lastName: z.string().min(1, "Last name is required."),
  tagIds: z.array(z.string()).optional().default([]),
  signupIntent: z.enum(["resident", "business", "seller"]).optional(),
  ref: z.string().min(1).max(32).optional(),
});

function zodErrorToMessage(e: z.ZodError): string {
  const first = e.errors[0];
  if (first) return first.message;
  return "Please check your input (email, password at least 8 characters, first and last name).";
}

export async function POST(req: NextRequest) {
  const key = `signup:${getClientIdentifier(req)}`;
  const { allowed } = checkRateLimit(key);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts. Please try again in a minute." },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const { email, password, firstName, lastName, tagIds, signupIntent, ref } = schema.parse(body);
    const existing = await prisma.member.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already registered. Try signing in or use a different email." }, { status: 400 });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const member = await prisma.member.create({
      data: { email, passwordHash, firstName, lastName, signupIntent: signupIntent ?? "resident" },
    });
    awardMemberSignupBadges(member.id, signupIntent ?? "resident").catch(() => {});
    if (ref) {
      const referralLink = await prisma.referralLink.findUnique({ where: { code: ref } });
      if (referralLink && referralLink.memberId !== member.id) {
        await prisma.referralSignup.create({
          data: { referrerId: referralLink.memberId, newMemberId: member.id },
        });
        awardSpreadingTheWordBadge(referralLink.memberId).catch(() => {});
      }
    }
    if (tagIds?.length) {
      const validTags = await prisma.tag.findMany({
        where: { id: { in: tagIds } },
        select: { id: true },
      });
      if (validTags.length) {
        await prisma.followTag.createMany({
          data: validTags.map((t) => ({ memberId: member.id, tagId: t.id })),
          skipDuplicates: true,
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: zodErrorToMessage(e) }, { status: 400 });
    }
    console.error("[signup] error:", e);
    const err = e as { code?: string; message?: string };
    const code = err?.code != null ? String(err.code) : "";
    const msg = (err?.message ?? "").toLowerCase();
    const isDbError =
      code.startsWith("P") ||
      msg.includes("connect") ||
      msg.includes("econnrefused") ||
      msg.includes("database") ||
      msg.includes("connection");
    const message = isDbError
      ? "Database unavailable. Start PostgreSQL, set DATABASE_URL in .env, and run pnpm db:push."
      : "Sign up failed. Check the terminal where the app is running for the error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
