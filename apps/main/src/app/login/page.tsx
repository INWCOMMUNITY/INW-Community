"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useSearchParams, useRouter } from "next/navigation";
import { IonIcon } from "@/components/IonIcon";

type Plan = "subscribe" | "sponsor" | "seller";

const PLAN_OPTIONS: {
  plan: Plan;
  loginLabel: string;
  signUpLabel: string;
  icon: string;
}[] = [
  { plan: "subscribe", loginLabel: "Login as Resident", signUpLabel: "Sign up as Resident", icon: "person" },
  { plan: "sponsor", loginLabel: "Login as Business", signUpLabel: "Sign up as Business", icon: "business" },
  { plan: "seller", loginLabel: "Login as Seller", signUpLabel: "Sign up as Seller", icon: "briefcase" },
];

const PLAN_DISPLAY_NAMES: Record<Plan, string> = {
  subscribe: "Resident",
  sponsor: "Business",
  seller: "Seller",
};

function signUpHrefForPlan(plan: Plan | null): string {
  if (plan === "sponsor") return "/signup/business";
  if (plan === "seller") return "/signup/seller";
  return "/signup";
}

/** When set to the same login id as `ADMIN_EMAIL`, successful sign-in jumps to production admin (or `/admin` on the current origin). */
function postLoginUrlForAdminAccount(typedLogin: string, fallbackCallbackUrl: string): string {
  const adminLogin = process.env.NEXT_PUBLIC_ADMIN_EMAIL?.trim();
  if (!adminLogin || typedLogin.trim().toLowerCase() !== adminLogin.toLowerCase()) {
    return fallbackCallbackUrl;
  }

  const liveRaw = (
    process.env.NEXT_PUBLIC_LIVE_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_MAIN_SITE_URL?.trim() ||
    ""
  ).replace(/\/+$/, "");

  if (liveRaw && typeof window !== "undefined") {
    try {
      const normalized = liveRaw.includes("://") ? liveRaw : `https://${liveRaw}`;
      const liveOrigin = new URL(normalized).origin;
      if (liveOrigin !== window.location.origin) {
        return `${liveOrigin}/admin/dashboard`;
      }
    } catch {
      /* relative /admin below */
    }
  }

  return "/admin/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") ?? "/my-community";
  const fromSignup = searchParams?.get("fromSignup") === "1";
  const adminAccessDenied = searchParams?.get("adminError") === "notAdmin";
  const emailJustVerified = searchParams?.get("emailVerified") === "1";
  const verifyError = searchParams?.get("verifyError");
  const verifyPending = searchParams?.get("verifyPending") === "1";
  const verifyEmailParam = searchParams?.get("email")?.trim() ?? "";
  const planFromUrl = searchParams?.get("plan")?.trim() ?? "";
  const planFromQuery: Plan | null =
    planFromUrl === "subscribe" || planFromUrl === "sponsor" || planFromUrl === "seller" ? planFromUrl : null;

  const [isSignUp, setIsSignUp] = useState(false);
  const [showSignInForm, setShowSignInForm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  /** Set when credentials sign-in fails (distinct from network `error`). */
  const [loginError, setLoginError] = useState<
    "unknown_email" | "wrong_password" | "email_not_verified" | "generic" | null
  >(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [verifyCodeBusy, setVerifyCodeBusy] = useState(false);
  const [verifyCodeError, setVerifyCodeError] = useState<string | null>(null);
  const [verifyResendBusy, setVerifyResendBusy] = useState(false);
  const [verifyResendMessage, setVerifyResendMessage] = useState<string | null>(null);
  /** Shown after repeated failed credential sign-ins; reset when email changes. */
  const [credentialFailCount, setCredentialFailCount] = useState(0);
  const lastFailedEmailRef = useRef("");

  useEffect(() => {
    if (verifyEmailParam && !email) {
      setEmail(verifyEmailParam);
    }
  }, [verifyEmailParam, email]);

  useEffect(() => {
    if ((verifyPending || emailJustVerified) && planFromQuery) {
      setSelectedPlan(planFromQuery);
      setShowSignInForm(true);
      setIsSignUp(false);
    }
  }, [verifyPending, emailJustVerified, planFromQuery]);

  async function submitEmailVerificationCode(e: React.FormEvent) {
    e.preventDefault();
    const addr = (verifyEmailParam || email).trim();
    setVerifyCodeError(null);
    setVerifyResendMessage(null);
    if (!addr) {
      setVerifyCodeError("Email is missing. Open the link from sign up again.");
      return;
    }
    const digitsOnly = verifyCode.replace(/\D/g, "");
    if (digitsOnly.length !== 6) {
      setVerifyCodeError("Enter the 6-digit code from your email.");
      return;
    }
    setVerifyCodeBusy(true);
    try {
      const res = await fetch("/api/auth/verify-email-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr, code: verifyCode }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setVerifyCodeError(typeof data.error === "string" ? data.error : "Could not verify. Try again.");
        return;
      }
      const qs = new URLSearchParams();
      qs.set("callbackUrl", callbackUrl);
      qs.set("emailVerified", "1");
      qs.set("email", addr);
      if (planFromQuery) qs.set("plan", planFromQuery);
      router.replace(`/login?${qs.toString()}`);
    } catch {
      setVerifyCodeError("Could not reach the server. Check your connection.");
    } finally {
      setVerifyCodeBusy(false);
    }
  }

  function handleChoose(plan: Plan) {
    if (isSignUp) {
      if (plan === "subscribe") {
        window.location.href = "/signup";
        return;
      }
      if (plan === "sponsor") {
        window.location.href = "/signup/business";
        return;
      }
      window.location.href = "/signup/seller";
      return;
    }
    setSelectedPlan(plan);
    setCredentialFailCount(0);
    lastFailedEmailRef.current = "";
    setShowSignInForm(true);
  }

  async function handleSignInSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoginError(null);
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        if (res.error === "Configuration") {
          setError(
            "Sign-in is misconfigured on the server. Ensure NEXTAUTH_SECRET and NEXTAUTH_URL are set correctly in production.",
          );
          return;
        }
        const trimmed = email.trim();
        const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
        const looksLikePlainLoginId = /^[a-zA-Z0-9._-]{3,128}$/.test(trimmed);
        if (looksLikeEmail || looksLikePlainLoginId) {
          const hintRes = await fetch("/api/auth/login-hint", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: trimmed }),
          });
          const hintData = (await hintRes.json().catch(() => ({}))) as { exists?: boolean };
          if (hintRes.ok && hintData.exists === false) {
            lastFailedEmailRef.current = trimmed;
            setCredentialFailCount((c) => c + 1);
            setLoginError("unknown_email");
            return;
          }
          if (hintRes.ok && hintData.exists === true) {
            const csRes = await fetch("/api/auth/credential-status", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: trimmed, password }),
            });
            const cs = (await csRes.json().catch(() => ({}))) as {
              passwordMatch?: boolean;
              emailVerified?: boolean;
            };
            if (
              csRes.ok &&
              cs.passwordMatch === true &&
              cs.emailVerified === false
            ) {
              lastFailedEmailRef.current = trimmed;
              setCredentialFailCount((c) => c + 1);
              setLoginError("email_not_verified");
              return;
            }
            lastFailedEmailRef.current = trimmed;
            setCredentialFailCount((c) => c + 1);
            setLoginError("wrong_password");
            return;
          }
        }
        lastFailedEmailRef.current = trimmed;
        setCredentialFailCount((c) => c + 1);
        setLoginError("generic");
        return;
      }
      if (res?.ok) {
        window.location.href = postLoginUrlForAdminAccount(email, callbackUrl);
        return;
      }
      lastFailedEmailRef.current = email.trim();
      setCredentialFailCount((c) => c + 1);
      setLoginError("generic");
    } catch {
      setLoginError(null);
      setError("Could not connect. Check your connection and try again.");
    }
  }

  const showEntry = !showSignInForm;

  const signOutReturnToAdmin = `/api/auth/signout?callbackUrl=${encodeURIComponent(
    "/login?callbackUrl=" + encodeURIComponent("/admin/dashboard"),
  )}`;

  return (
    <div className="max-w-md mx-auto px-4 py-12 flex flex-col items-center w-full">
      {verifyPending ? (
        <form
          onSubmit={submitEmailVerificationCode}
          className="mb-6 p-4 rounded-lg text-sm w-full max-w-[320px] border border-blue-200 bg-blue-50 text-left space-y-3"
        >
          <div>
            <span className="font-semibold text-blue-900 block mb-1">Verify your email</span>
            <span className="text-blue-900">
              We sent a 6-digit code to{" "}
              <strong>{(verifyEmailParam || email).trim() || "your email"}</strong>. Enter it below to finish sign
              up—then you can sign in.
            </span>
          </div>
          <div>
            <label htmlFor="verify-code" className="block text-xs font-medium text-blue-900 mb-1">
              Verification code
            </label>
            <input
              id="verify-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={14}
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              className="w-full border rounded px-3 py-2 border-blue-300 bg-white text-lg tracking-widest font-mono"
              placeholder="000000"
            />
          </div>
          {verifyCodeError ? (
            <p className="text-red-700 text-sm" role="alert">
              {verifyCodeError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={verifyCodeBusy}
            className="btn w-full py-2 text-sm disabled:opacity-60"
          >
            {verifyCodeBusy ? "Checking…" : "Verify email"}
          </button>
          <button
            type="button"
            disabled={verifyResendBusy || !(verifyEmailParam || email).trim()}
            className="text-sm font-semibold underline disabled:opacity-50 text-blue-900"
            onClick={async () => {
              const addr = (verifyEmailParam || email).trim();
              setVerifyResendMessage(null);
              setVerifyCodeError(null);
              setVerifyResendBusy(true);
              try {
                const r = await fetch("/api/auth/resend-verification", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ email: addr }),
                });
                const d = (await r.json().catch(() => ({}))) as { message?: string };
                setVerifyResendMessage(
                  typeof d.message === "string" ? d.message : "If that email is registered, we sent a code.",
                );
              } catch {
                setVerifyResendMessage("Could not send. Try again in a minute.");
              } finally {
                setVerifyResendBusy(false);
              }
            }}
          >
            {verifyResendBusy ? "Sending…" : "Resend code"}
          </button>
          {verifyResendMessage ? <p className="text-blue-900 text-xs">{verifyResendMessage}</p> : null}
        </form>
      ) : null}
      {emailJustVerified ? (
        <p
          className="mb-6 p-3 rounded-lg text-sm w-full max-w-[320px] border border-green-200 bg-green-50 text-left"
          role="status"
        >
          <span className="font-semibold text-green-900 block mb-1">Email verified</span>
          <span className="text-green-900">You can sign in below.</span>
        </p>
      ) : null}
      {verifyError === "expired" ? (
        <p
          className="mb-6 p-3 rounded-lg text-sm w-full max-w-[320px] border border-amber-200 bg-amber-50 text-left"
          role="alert"
        >
          That verification code or link has expired. Sign in if you&apos;re already verified, or request a new code
          after a failed sign-in attempt (Resend verification).
        </p>
      ) : verifyError === "missing" ? (
        <p
          className="mb-6 p-3 rounded-lg text-sm w-full max-w-[320px] border border-amber-200 bg-amber-50 text-left"
          role="alert"
        >
          Invalid verification link.
        </p>
      ) : null}
      {adminAccessDenied ? (
        <p
          className="mb-6 p-3 rounded-lg text-sm w-full max-w-[320px] border border-red-200 bg-red-50 text-left"
          role="alert"
        >
          <span className="font-semibold text-red-800 block mb-1">Admin access</span>
          <span className="text-red-900">
            This account is not recognized as admin. Use the member email that matches{" "}
            <strong>ADMIN_EMAIL</strong> in production (e.g. Vercel env), or add{" "}
            <strong>ADMIN_EMAIL</strong> there to match the account you sign in with.
          </span>
          <Link
            href={signOutReturnToAdmin}
            className="mt-2 inline-block font-semibold underline"
            style={{ color: "var(--color-primary)" }}
          >
            Sign out and try another account
          </Link>
        </p>
      ) : null}
      {showEntry ? (
        <>
          <Link
            href="/"
            className="self-start flex items-center gap-2 text-sm font-medium mb-6"
            style={{ color: "var(--color-primary)" }}
          >
            <IonIcon name="arrow-back" size={20} />
            Back
          </Link>
          <div className="flex flex-col items-center mb-6">
            <Image
              src="/nwc-logo-circle-crop.png"
              alt="Northwest Community"
              width={140}
              height={140}
              className="object-contain mb-3"
            />
            <h1 className="text-2xl font-bold text-center" style={{ color: "var(--color-heading)" }}>
              Northwest Community
            </h1>
            <p className="text-sm text-center mt-1" style={{ color: "var(--color-text)" }}>
              Welcome Residents of Eastern Washington & North Idaho
            </p>
            <p className="text-base mt-3 text-center w-full" style={{ color: "var(--color-text)" }}>
              {isSignUp ? "Create an account" : "Sign in to continue"}
            </p>
          </div>
          <div
            className="flex flex-row rounded-lg p-1 mb-5 w-full max-w-[320px]"
            style={{ backgroundColor: "var(--color-cream, #faf5ee)" }}
          >
            <button
              type="button"
              onClick={() => setIsSignUp(false)}
              className={`flex-1 py-2.5 px-6 rounded-md text-base font-semibold text-center transition-colors ${
                !isSignUp ? "text-white" : ""
              }`}
              style={{
                backgroundColor: !isSignUp ? "var(--color-primary)" : "transparent",
                color: !isSignUp ? "var(--color-button-text, #fff)" : "var(--color-text)",
              }}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => setIsSignUp(true)}
              className={`flex-1 py-2.5 px-6 rounded-md text-base font-semibold text-center transition-colors ${
                isSignUp ? "text-white" : ""
              }`}
              style={{
                backgroundColor: isSignUp ? "var(--color-primary)" : "transparent",
                color: isSignUp ? "var(--color-button-text, #fff)" : "var(--color-text)",
              }}
            >
              Sign up
            </button>
          </div>
          <div className="w-full max-w-[320px] space-y-4">
            {PLAN_OPTIONS.map((opt) => (
              <button
                key={opt.plan}
                type="button"
                onClick={() => handleChoose(opt.plan)}
                className="w-full flex items-center gap-4 p-5 rounded-xl border-2 text-left transition-opacity hover:opacity-90 focus:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2"
                style={{
                  borderColor: "var(--color-primary)",
                  backgroundColor: "#fff",
                  color: "var(--color-heading)",
                }}
              >
                <span
                  className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: "var(--color-cream, #faf5ee)", color: "var(--color-primary)" }}
                >
                  <IonIcon name={opt.icon} size={40} />
                </span>
                <span className="text-lg font-semibold">
                  {isSignUp ? opt.signUpLabel : opt.loginLabel}
                </span>
              </button>
            ))}
          </div>
          {isSignUp && (
            <p className="text-sm text-center mt-4 px-4" style={{ color: "var(--color-text)" }}>
              Choose your account type to get started.
            </p>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              setShowSignInForm(false);
              setSelectedPlan(null);
              setError("");
              setLoginError(null);
              setCredentialFailCount(0);
              lastFailedEmailRef.current = "";
            }}
            className="self-start flex items-center gap-2 text-sm font-medium mb-6"
            style={{ color: "var(--color-primary)" }}
          >
            <IonIcon name="arrow-back" size={20} />
            Back
          </button>
          <h1 className="text-2xl font-bold mb-6 w-full text-center" style={{ color: "var(--color-heading)" }}>
            Sign in as {selectedPlan ? PLAN_DISPLAY_NAMES[selectedPlan] : ""}
          </h1>
          {fromSignup && (
            <p className="mb-4 p-3 rounded-lg text-sm w-full" style={{ backgroundColor: "var(--color-section-alt)", color: "var(--color-primary)" }}>
              Account created. Sign in below to continue to Inland Northwest Community.
            </p>
          )}
          <form onSubmit={handleSignInSubmit} className="space-y-4 w-full">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">Email or username</label>
              <input
                id="email"
                type="text"
                autoComplete="username"
                value={email}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v.trim() !== lastFailedEmailRef.current) {
                    setCredentialFailCount(0);
                  }
                  setEmail(v);
                }}
                required
                className="w-full border rounded px-3 py-2 border-gray-300"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full border rounded px-3 py-2 border-gray-300"
              />
              {credentialFailCount >= 2 ? (
                <p className="mt-1 text-right">
                  <Link
                    href="/forgot-password"
                    className="text-sm font-medium no-underline hover:underline"
                    style={{ color: "var(--color-primary)" }}
                  >
                    Forgot password?
                  </Link>
                </p>
              ) : null}
            </div>
            {loginError === "unknown_email" ? (
              <div className="text-red-600 text-sm space-y-1">
                <p>That email or login ID is not registered. New to NWC?</p>
                <p>
                  <Link
                    href={signUpHrefForPlan(selectedPlan)}
                    className="font-semibold no-underline hover:opacity-90"
                    style={{ color: "var(--color-primary)" }}
                  >
                    Sign Up!
                  </Link>
                </p>
              </div>
            ) : null}
            {loginError === "wrong_password" ? (
              <p className="text-red-600 text-sm">Incorrect password.</p>
            ) : null}
            {loginError === "email_not_verified" ? (
              <div className="text-amber-800 text-sm space-y-2">
                <p>
                  This email isn&apos;t verified yet. Check your inbox for a <strong>6-digit code</strong> from
                  Northwest Community, or resend a new code.
                </p>
                <button
                  type="button"
                  disabled={resendBusy || !email.trim()}
                  className="text-sm font-semibold underline disabled:opacity-50"
                  style={{ color: "var(--color-primary)" }}
                  onClick={async () => {
                    setResendMessage(null);
                    setResendBusy(true);
                    try {
                      const r = await fetch("/api/auth/resend-verification", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: email.trim() }),
                      });
                      const d = (await r.json().catch(() => ({}))) as { message?: string };
                      setResendMessage(
                        typeof d.message === "string"
                          ? d.message
                          : "If that email is registered, we sent a code.",
                      );
                    } catch {
                      setResendMessage("Could not send. Try again in a minute.");
                    } finally {
                      setResendBusy(false);
                    }
                  }}
                >
                  {resendBusy ? "Sending…" : "Resend verification code"}
                </button>
                {resendMessage ? <p className="text-gray-700">{resendMessage}</p> : null}
              </div>
            ) : null}
            {loginError === "generic" ? (
              <p className="text-red-600 text-sm">Something went wrong. Please try again.</p>
            ) : null}
            {error ? <p className="text-red-600 text-sm">{error}</p> : null}
            <button type="submit" className="btn w-full">Log in</button>
          </form>
          <p className="mt-4 text-center text-sm w-full">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => {
                setShowSignInForm(false);
                setSelectedPlan(null);
                setIsSignUp(true);
                setCredentialFailCount(0);
                lastFailedEmailRef.current = "";
              }}
              className="underline"
              style={{ color: "var(--color-primary)" }}
            >
              Sign up
            </button>
          </p>
        </>
      )}
      <p className="mt-8 text-center text-xs">
        <Link href="/terms" className="underline opacity-80">Terms</Link>
        <span className="mx-1">·</span>
        <Link href="/privacy" className="underline opacity-80">Privacy</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="max-w-md mx-auto px-4 py-12">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
