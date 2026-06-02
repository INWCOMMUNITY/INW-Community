import { SignJWT, jwtVerify } from "jose";
import type { ChannelProvider } from "./types";

const ISSUER = "nwc-channel-oauth";
const TTL = "10m";

function secret() {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required");
  return new TextEncoder().encode(s);
}

export type ChannelOAuthStatePayload = {
  /** Member id */
  sub: string;
  /** Channel provider (etsy, ebay, ...) */
  provider: ChannelProvider;
  /** When true, the callback redirects to the mobile app deep link. */
  app: boolean;
  /** PKCE code_verifier (carried in the signed state so the callback can complete the exchange). */
  verifier: string;
  /** Shopify only: normalized `{slug}.myshopify.com` captured at connect start. */
  shop?: string;
};

/**
 * Signed JWT used as the OAuth `state`. The provider treats it as opaque and echoes it back.
 * Signing prevents tampering, so it can safely carry the PKCE verifier for in-app browsers.
 */
export async function signChannelOAuthState(args: {
  memberId: string;
  provider: ChannelProvider;
  app: boolean;
  verifier: string;
  shop?: string;
}): Promise<string> {
  return new SignJWT({
    provider: args.provider,
    app: args.app,
    verifier: args.verifier,
    ...(args.shop ? { shop: args.shop } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(args.memberId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret());
}

export async function verifyChannelOAuthState(
  state: string
): Promise<ChannelOAuthStatePayload | null> {
  try {
    const { payload } = await jwtVerify(state, secret(), { issuer: ISSUER });
    const sub = payload.sub;
    const provider = payload.provider as ChannelProvider | undefined;
    const verifier = payload.verifier as string | undefined;
    if (!sub || !provider || !verifier) return null;
    const shop = typeof payload.shop === "string" ? payload.shop : undefined;
    return { sub, provider, app: Boolean(payload.app), verifier, shop };
  } catch {
    return null;
  }
}
