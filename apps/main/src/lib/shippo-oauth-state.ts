import { SignJWT, jwtVerify } from "jose";

const ISSUER = "nwc-shippo-oauth";
const TTL = "10m";

function secret() {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required");
  return new TextEncoder().encode(s);
}

export type ShippoOAuthStatePayload = {
  /** Member id */
  sub: string;
  /** When true, oauth-callback redirects to the mobile app scheme */
  app: boolean;
};

/**
 * Signed JWT passed as Shippo OAuth `state`. Replaces cookie binding so in-app browsers work.
 */
export async function signShippoOAuthState(memberId: string, app: boolean): Promise<string> {
  return new SignJWT({ app })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(secret());
}

export async function verifyShippoOAuthState(
  state: string
): Promise<ShippoOAuthStatePayload | null> {
  try {
    const { payload } = await jwtVerify(state, secret(), {
      issuer: ISSUER,
    });
    const sub = payload.sub;
    if (!sub) return null;
    return { sub, app: Boolean(payload.app) };
  } catch {
    return null;
  }
}
