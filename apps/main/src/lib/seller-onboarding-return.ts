import type { NextRequest, NextResponse } from "next/server";

/** Short-lived marker so OAuth callbacks return to seller onboarding. */
export const SELLER_ONBOARDING_RETURN_COOKIE = "nwc_seller_onboarding";

export type SellerOnboardingReturn = "shipping" | "import";

const RETURNS: Record<SellerOnboardingReturn, string> = {
  shipping: "/signup/seller?step=shipping",
  import: "/signup/seller?step=import",
};

export function readSellerOnboardingReturn(req: NextRequest): SellerOnboardingReturn | null {
  const value = req.cookies.get(SELLER_ONBOARDING_RETURN_COOKIE)?.value;
  if (value === "shipping" || value === "import") return value;
  return null;
}

export function sellerOnboardingReturnPath(step: SellerOnboardingReturn, query?: Record<string, string>): string {
  const url = new URL(RETURNS[step], "http://localhost");
  if (query) {
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

export function setSellerOnboardingReturnCookie(response: NextResponse, step: SellerOnboardingReturn) {
  response.cookies.set(SELLER_ONBOARDING_RETURN_COOKIE, step, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30 * 60,
  });
}

export function clearSellerOnboardingReturnCookie(response: NextResponse) {
  response.cookies.set(SELLER_ONBOARDING_RETURN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
