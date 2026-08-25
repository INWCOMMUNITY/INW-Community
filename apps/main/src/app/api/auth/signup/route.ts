import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "database";
import { checkRateLimit, getClientIdentifier } from "@/lib/rate-limit";
import { normalizeResidentCity } from "@/lib/city-utils";
import { validateMemberDisplayNameFields } from "@/lib/member-display-name-policy";
import { issueEmailVerification } from "@/lib/email-verification";

const schema = z.object({
  email: z
    .string({ required_error: "Email is required." })
    .email("Please enter a valid email address."),
  password: z
    .string({ required_error: "Password is required." })
    .min(8, "Password must be at least 8 characters.")
    .max(128),
  firstName: z.string().optional().transform((v) => v?.trim() ?? ""),
  lastName: z.string().optional().transform((v) => v?.trim() ?? ""),
  city: z.string().optional().transform((v) => v?.trim() || null),
  tagIds: z.array(z.string()).optional().default([]),
  tagNames: z.array(z.string().max(50)).optional().default([]),
  signupIntent: z.enum(["resident", "business", "seller"]).optional(),
  ref: z.string().min(1).max(32).optional(),
}).refine(
  (d) => {
    if (d.signupIntent === "business" || d.signupIntent === "seller") return true;
    return (d.firstName ?? "").length > 0 && (d.lastName ?? "").length > 0;
  },
  { message: "First name and last name are required for resident signup.", path: ["firstName"] }
);

const HIDDEN_TAG_SLUGS = new Set(["null", "void", "test", "pest-control"]);

function slugifyTagName(s: string): string {
  return s
    .toLowerCase()
    .replace(/^#+/, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Follow existing tags only — never create new global tags from signup. */
async function followExistingSignupTags(memberId: string, tagIds: string[], tagNames: string[]) {
  const slugs = tagNames.map(slugifyTagName).filter((slug) => slug && !HIDDEN_TAG_SLUGS.has(slug));
  const ids = tagIds.filter(Boolean);
  if (!ids.length && !slugs.length) return;

  const tags = await prisma.tag.findMany({
    where: {
      slug: { notIn: [...HIDDEN_TAG_SLUGS] },
      OR: [
        ...(ids.length ? [{ id: { in: ids } }] : []),
        ...(slugs.length ? [{ slug: { in: slugs } }] : []),
      ],
    },
    select: { id: true },
  });
  if (!tags.length) return;
  await prisma.followTag.createMany({
    data: tags.map((t) => ({ memberId, tagId: t.id })),
    skipDuplicates: true,
  });
}

function zodErrorToMessage(e: z.ZodError): string {
  const first = e.errors[0];
  if (first) {
    const msg = first.message;
    // Map generic Zod messages to user-friendly ones
    if (msg === "Required" || msg.toLowerCase() === "required") {
      const path = first.path?.join(".");
      if (path === "email") return "Email is required.";
      if (path === "password") return "Password is required.";
      return "Please fill in all required fields.";
    }
    return msg;
  }
  return "Please check your input (email, password at least 8 characters).";
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
    const parsed = schema.parse(body);
    const { email, password, tagIds, tagNames, signupIntent, ref } = parsed;
    const firstName = (parsed.firstName ?? "").trim() || "Pending";
    const lastName = (parsed.lastName ?? "").trim() || "Pending";
    const namePolicyError = validateMemberDisplayNameFields(firstName, lastName);
    if (namePolicyError) {
      return NextResponse.json({ error: namePolicyError }, { status: 400 });
    }
    const city = parsed.city ? normalizeResidentCity(parsed.city) || null : null;
    const existing = await prisma.member.findUnique({
      where: { email },
      include: { subscriptions: { where: { status: { in: ["active", "trialing"] } }, take: 1 } },
    });

    if (existing) {
      const hasActiveSub = existing.subscriptions.length > 0;
      const isIncomplete = !hasActiveSub && existing.firstName === "Pending" && existing.lastName === "Pending";

      if (!isIncomplete) {
        return NextResponse.json({ error: "Email already registered. Try signing in or use a different email." }, { status: 400 });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const member = await prisma.member.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          firstName,
          lastName,
          city: city ?? undefined,
          signupIntent: signupIntent ?? "resident",
        },
      });
      if (ref) {
        const referralLink = await prisma.referralLink.findUnique({ where: { code: ref } });
        if (referralLink && referralLink.memberId !== member.id) {
          const existing = await prisma.referralSignup.findFirst({
            where: { newMemberId: member.id },
          });
          if (!existing) {
            await prisma.referralSignup.create({
              data: { referrerId: referralLink.memberId, newMemberId: member.id },
            });
          }
        }
      }
      await followExistingSignupTags(member.id, tagIds, tagNames);
      const intent = signupIntent ?? "resident";
      const isBizOrSeller = intent === "business" || intent === "seller";
      const needsEmailVerification = !member.emailVerifiedAt && !isBizOrSeller;
      let verificationEmailSent = true;
      if (needsEmailVerification) {
        verificationEmailSent = await issueEmailVerification(member.id, member.email);
      }
      return NextResponse.json({
        ok: true,
        requiresEmailVerification: needsEmailVerification,
        ...(needsEmailVerification ? { verificationEmailSent } : {}),
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const member = await prisma.member.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        city: city ?? undefined,
        signupIntent: signupIntent ?? "resident",
      },
    });
    if (ref) {
      const referralLink = await prisma.referralLink.findUnique({ where: { code: ref } });
      if (referralLink && referralLink.memberId !== member.id) {
        await prisma.referralSignup.create({
          data: { referrerId: referralLink.memberId, newMemberId: member.id },
        });
      }
    }
    await followExistingSignupTags(member.id, tagIds, tagNames);
    const intent = signupIntent ?? "resident";
    const isBizOrSeller = intent === "business" || intent === "seller";
    const needsEmailVerification = !member.emailVerifiedAt && !isBizOrSeller;
    let verificationEmailSent = true;
    if (needsEmailVerification) {
      verificationEmailSent = await issueEmailVerification(member.id, member.email);
    }
    return NextResponse.json({
      ok: true,
      requiresEmailVerification: needsEmailVerification,
      ...(needsEmailVerification ? { verificationEmailSent } : {}),
    });
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
