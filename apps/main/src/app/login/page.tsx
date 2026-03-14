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

function LoginForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams?.get("callbackUrl") ?? "/my-community";
  const fromSignup = searchParams?.get("fromSignup") === "1";

  const [isSignUp, setIsSignUp] = useState(false);
  const [showSignInForm, setShowSignInForm] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

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
    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (res?.error) {
        setError("Invalid email or password. Don't have an account? Sign up first.");
        return;
      }
      if (res?.ok) {
        window.location.href = callbackUrl;
        return;
      }
      setError("Something went wrong. Please try again.");
    } catch {
      setError("Could not connect. Check your connection and try again.");
    }
  }

  const showEntry = !showSignInForm;

  return (
    <div className="max-w-md mx-auto px-4 py-12 flex flex-col items-center">
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
            <p className="text-base mt-3" style={{ color: "var(--color-text)" }}>
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
              className={`flex-1 py-2.5 px-6 rounded-md text-base font-semibold transition-colors ${
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
              className={`flex-1 py-2.5 px-6 rounded-md text-base font-semibold transition-colors ${
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
            onClick={() => { setShowSignInForm(false); setSelectedPlan(null); setError(""); }}
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
            {error && (
              <p className="text-red-600 text-sm">
                {error}
                {error.includes("Sign up first") && (
                  <> <Link href="/signup" className="underline">Sign up</Link></>
                )}
              </p>
            )}
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
