import { apiPost, getToken, setToken, clearToken } from "./api";

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

export async function signIn(
  email: string,
  password: string,
  plan?: SubscriptionPlan
): Promise<SignInResult> {
  const data = await apiPost<SignInResult>("/api/auth/mobile-signin", {
    email,
    password,
    ...(plan && { plan }),
  });
  if (!data.token) {
    throw new Error("No token in response");
  }
  await setToken(data.token);
  return data;
}

export async function signOut(): Promise<void> {
  await clearToken();
}

export async function isAuthenticated(): Promise<boolean> {
  const token = await getToken();
  return !!token;
}
