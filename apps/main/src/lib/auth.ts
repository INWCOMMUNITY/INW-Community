import CredentialsProvider from "next-auth/providers/credentials";
import { getServerSession as nextAuthGetServerSession } from "next-auth";
import { prisma } from "database";
import bcrypt from "bcryptjs";
import {
  prismaWhereMemberSubscribePlanAccess,
  prismaWhereMemberSubscribeTierPerksAccess,
} from "@/lib/subscribe-plan-access";

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const loginId = credentials.email.trim();
        if (!loginId) return null;
        try {
          // PostgreSQL unique email is case-sensitive; stored casing may differ from
          // what users type. Insensitive match avoids false "invalid password" 401s.
          const member = await prisma.member.findFirst({
            where: { email: { equals: loginId, mode: "insensitive" } },
          });
          if (!member) return null;
          if (member.status === "suspended") return null;
          const ok = await bcrypt.compare(credentials.password, member.passwordHash);
          if (!ok) return null;
          return {
            id: member.id,
            email: member.email,
            name: `${member.firstName} ${member.lastName}`,
            image: member.profilePhotoUrl ?? undefined,
          };
        } catch (e) {
          console.error("[next-auth authorize]", e);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    // eslint-disable-next-line
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },
    // eslint-disable-next-line
    async session({ session, token }: any) {
      if (!session.user) return session;
      const memberId = token.id as string | undefined;
      const tokenEmail = token.email as string | undefined;
      if (tokenEmail && !session.user.email) {
        (session.user as { email?: string }).email = tokenEmail;
      }
      (session.user as { id?: string }).id = memberId;
      try {
        if (memberId) {
          const [subTier, subResale] = await Promise.all([
            prisma.subscription.findFirst({
              where: prismaWhereMemberSubscribeTierPerksAccess(memberId),
              select: { id: true },
            }),
            prisma.subscription.findFirst({
              where: prismaWhereMemberSubscribePlanAccess(memberId),
              select: { id: true },
            }),
          ]);
          (session.user as { isSubscriber?: boolean }).isSubscriber = !!subTier;
          /** NWC Resale Hub — Resident Subscribe plan only (not Business/Seller). */
          (session.user as { canAccessResaleHub?: boolean }).canAccessResaleHub = !!subResale;
        } else {
          (session.user as { isSubscriber?: boolean }).isSubscriber = false;
          (session.user as { canAccessResaleHub?: boolean }).canAccessResaleHub = false;
        }
        const adminEmail = process.env.ADMIN_EMAIL?.trim();
        let emailForAdmin = tokenEmail ?? (session.user?.email as string | undefined);
        if (!emailForAdmin && memberId && adminEmail) {
          const m = await prisma.member.findUnique({
            where: { id: memberId },
            select: { email: true },
          });
          emailForAdmin = m?.email ?? undefined;
        }
        (session.user as { isAdmin?: boolean }).isAdmin =
          !!adminEmail &&
          !!emailForAdmin &&
          emailForAdmin.toLowerCase() === adminEmail.toLowerCase();
      } catch (e) {
        console.error("[next-auth session callback]", e);
        (session.user as { isSubscriber?: boolean }).isSubscriber = false;
        (session.user as { canAccessResaleHub?: boolean }).canAccessResaleHub = false;
        // Keep admin from JWT email when DB reads fail (timeouts) so ADMIN_EMAIL
        // still matches without requiring subscription queries.
        const adminEmail = process.env.ADMIN_EMAIL?.trim();
        let emailForAdmin = tokenEmail ?? (session.user?.email as string | undefined);
        (session.user as { isAdmin?: boolean }).isAdmin =
          !!adminEmail &&
          !!emailForAdmin &&
          emailForAdmin.toLowerCase() === adminEmail.toLowerCase();
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    signOut: "/auth/signout",
    error: "/auth/error",
  },
  session: { strategy: "jwt" as const },
  secret: process.env.NEXTAUTH_SECRET,
  // Required on Vercel so NextAuth uses the request host for callbacks/cookies
  trustHost: true,
};

/**
 * Safe wrapper for getServerSession. When the request context or cookies are
 * null (e.g. in some App Router / edge cases), next-auth can throw
 * "Cannot read properties of null (reading 'get')". This catches that and
 * returns null so the app renders instead of crashing.
 */
export async function getServerSession(options?: typeof authOptions) {
  try {
    return await nextAuthGetServerSession(options ?? authOptions);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Only swallow the known NextAuth/cookies null-headers failure — not every
    // error that happens to mention "null" (that hid real bugs and looked like logout).
    if (msg.includes("reading 'get')")) {
      return null;
    }
    throw e;
  }
}
