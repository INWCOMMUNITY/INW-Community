import { jwtVerify } from "jose";

const JWT_ISSUER_MOBILE = "nwc-mobile";
const JWT_ISSUER_REALTIME = "nwc-realtime";

function getSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is required for realtime auth");
  return new TextEncoder().encode(secret);
}

/** Resolve member id from mobile session JWT or short-lived realtime socket token. */
export async function verifySocketAuthToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const iss = String(payload.iss ?? "");
    if (iss === JWT_ISSUER_REALTIME && typeof payload.sub === "string" && payload.sub) {
      return payload.sub;
    }
    if (iss === JWT_ISSUER_MOBILE) {
      const id = payload.id as string | undefined;
      if (id) return id;
    }
    return null;
  } catch {
    return null;
  }
}
