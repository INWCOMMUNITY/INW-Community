import { SignJWT } from "jose";

const JWT_ISSUER_REALTIME = "nwc-realtime";

function getSecret() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for realtime token");
  return new TextEncoder().encode(secret);
}

/** Short-lived JWT for browser Socket.IO (NextAuth cookie sessions have no Bearer token). */
export async function signRealtimeSocketToken(memberId: string): Promise<string> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(memberId)
    .setIssuedAt()
    .setIssuer(JWT_ISSUER_REALTIME)
    .setExpirationTime("7d")
    .sign(getSecret());
  return token;
}
