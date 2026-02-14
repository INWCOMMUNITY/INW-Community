import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "database";
import bcrypt from "bcryptjs";

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
        const email = credentials.email.trim().toLowerCase();
        const member = await prisma.member.findUnique({
          where: { email },
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
      },
    }),
  ],
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }: any) {
      if (session.user) {
        (session.user as { id?: string }).id = token.id as string;
        const memberId = token.id as string | undefined;
        if (memberId) {
          const sub = await prisma.subscription.findFirst({
            where: { memberId, plan: "subscribe", status: "active" },
            select: { id: true },
          });
          (session.user as { isSubscriber?: boolean }).isSubscriber = !!sub;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" as const },
  secret: process.env.NEXTAUTH_SECRET,
};
