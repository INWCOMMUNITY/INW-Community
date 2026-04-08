import { apiPost, setToken, clearToken, getToken } from "./api";

export type SubscriptionPlan = "subscribe" | "sponsor" | "seller";

export interface SignInResult {
  token: string;
  subscriptionPlan?: SubscriptionPlan | null;
  member?: {
    firstName: string;
    lastName: string;
    email: string;
    profilePhotoUrl: string | null;
    bio?: string | null;
    city?: string | null;
  };
}

export type SignInNeedsVerification = {
  requiresEmailVerification: true;
  email: string;
};

export type SignInOutcome = SignInResult | SignInNeedsVerification;

function isNeedsVerificationPayload(
  data: unknown
): data is { requiresEmailVerification: true; email: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { requiresEmailVerification?: boolean }).requiresEmailVerification === true &&
    typeof (data as { email?: string }).email === "string"
  );
}

/**
 * Mobile sign-in. If the password is correct but email is not verified yet, returns
 * `{ requiresEmailVerification, email }` (no token) so the app can open the 6-digit flow.
 */
export async function signIn(
  email: string,
  password: string,
  plan?: SubscriptionPlan
): Promise<SignInOutcome> {
  const data = await apiPost<unknown>("/api/auth/mobile-signin", {
    email,
    password,
    ...(plan && { plan }),
  });
  if (isNeedsVerificationPayload(data)) {
    return { requiresEmailVerification: true, email: data.email };
  }
  const session = data as SignInResult;
  if (!session.token) {
    throw new Error("No token in response");
  }
  await setToken(session.token);
  return session;
}

export async function signOut(): Promise<void> {
  await clearToken();
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  return !!token;
}
