import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const JWT_ISSUER = "nwc-mobile";
const JWT_EXPIRY = "30d";

function getSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for mobile auth");
  return new TextEncoder().encode(secret);
}

export type SubscriptionPlan = "subscribe" | "sponsor" | "seller";

export interface MobileTokenPayload {
  id: string;
  email: string;
  name: string;
  isSubscriber?: boolean;
  subscriptionPlan?: SubscriptionPlan;
}

export async function signMobileToken(payload: MobileTokenPayload): Promise<string> {
  const token = await new SignJWT({
    id: payload.id,
    email: payload.email,
    name: payload.name,
    isSubscriber: payload.isSubscriber ?? false,
    subscriptionPlan: payload.subscriptionPlan ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
  return token;
}

export async function verifyMobileToken(token: string): Promise<MobileTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
    });
    const id = payload.id as string;
    const email = payload.email as string;
    const name = payload.name as string;
    const isSubscriber = Boolean(payload.isSubscriber);
    const subscriptionPlan = payload.subscriptionPlan as SubscriptionPlan | undefined;
    if (!id || !email) return null;
    return { id, email, name, isSubscriber, subscriptionPlan };
  } catch {
    return null;
  }
}

export function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

/**
 * For API routes: get session from NextAuth cookie OR from Authorization Bearer token.
 * Returns session-like shape: { user: { id, email, name, isSubscriber? } }
 */
export async function getSessionForApi(
  req: NextRequest
): Promise<{ user: { id: string; email: string; name?: string; isSubscriber?: boolean; subscriptionPlan?: SubscriptionPlan } } | null> {
  // 1. Try Bearer token (mobile app)
  const bearer = getBearerToken(req);
  if (bearer) {
    const payload = await verifyMobileToken(bearer);
    if (payload) {
      return {
        user: {
          id: payload.id,
          email: payload.email,
          name: payload.name,
          isSubscriber: payload.isSubscriber,
          subscriptionPlan: payload.subscriptionPlan,
        },
      };
    }
  }

  // 2. Try NextAuth session (web)
  const session = await getServerSession(authOptions);
  if (session?.user) {
    const u = session.user as { id?: string; email?: string; name?: string; isSubscriber?: boolean; subscriptionPlan?: SubscriptionPlan };
    if (u.id) {
      return {
        user: {
          id: u.id,
          email: u.email ?? "",
          name: u.name ?? undefined,
          isSubscriber: u.isSubscriber,
          subscriptionPlan: u.subscriptionPlan,
        },
      };
    }
  }

  return null;
}
