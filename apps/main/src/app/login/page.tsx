"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
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

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") ?? "/my-community";
  const fromSignup = searchParams?.get("fromSignup") === "1";
  const adminAccessDenied = searchParams?.get("adminError") === "notAdmin";

  const [isSignUp, setIsSignUp] = useState(false);
  const [showSignInForm, setShowSignInForm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  /** Set when credentials sign-in fails (distinct from network `error`). */
  const [loginError, setLoginError] = useState<"unknown_email" | "wrong_password" | "generic" | null>(null);

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
        const trimmed = email.trim().toLowerCase();
        const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
        if (looksLikeEmail) {
          const hintRes = await fetch("/api/auth/login-hint", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: trimmed }),
          });
          const hintData = (await hintRes.json().catch(() => ({}))) as { exists?: boolean };
          if (hintRes.ok && hintData.exists === false) {
            setLoginError("unknown_email");
            return;
          }
          if (hintRes.ok && hintData.exists === true) {
            setLoginError("wrong_password");
            return;
          }
        }
        setLoginError("generic");
        return;
      }
      if (res?.ok) {
        window.location.href = callbackUrl;
        return;
      }
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
            onClick={() => { setShowSignInForm(false); setSelectedPlan(null); setError(""); setLoginError(null); }}
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
                onChange={(e) => setEmail(e.target.value)}
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
            </div>
            {loginError === "unknown_email" ? (
              <div className="text-red-600 text-sm space-y-1">
                <p>Email not recognized. New to NWC?</p>
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
              onClick={() => { setShowSignInForm(false); setSelectedPlan(null); setIsSignUp(true); }}
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
