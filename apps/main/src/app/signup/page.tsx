"use client";

import { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { safeInternalPath } from "@/lib/safe-internal-path";
import { CityPicker } from "@/components/CityPicker";
import { normalizeResidentCity } from "@/lib/city-utils";
import { IonIcon } from "@/components/IonIcon";

interface Tag {
  id: string;
  name: string;
  slug: string;
}

const DEFAULT_AFTER_SIGNUP = "/my-community";

const BASIC_INTERESTS = [
  "Arts",
  "Business",
  "Community",
  "Crafts",
  "Dogs",
  "Events",
  "Family",
  "Fishing",
  "Fitness",
  "Food",
  "Gardening",
  "Local",
  "Music",
  "Sports",
  "Theatre",
] as const;

const HIDDEN_INTERESTS = new Set(["null", "void", "test", "pest control", "pest-control"]);

const fieldClass =
  "w-full rounded-lg border border-[var(--color-primary)]/25 bg-white px-3 py-2.5 text-[var(--color-heading)] outline-none transition-shadow placeholder:text-gray-400 focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/20";

function interestKey(name: string) {
  return name.trim().replace(/^#+/, "").toLowerCase();
}

function SignupForm() {
  const searchParams = useSearchParams();
  const refCode = searchParams?.get("ref") ?? undefined;
  const afterSignup = safeInternalPath(searchParams?.get("next"), DEFAULT_AFTER_SIGNUP);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [retypePassword, setRetypePassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [city, setCity] = useState("");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [customNames, setCustomNames] = useState<string[]>([]);
  const [newHashtag, setNewHashtag] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/tags?limit=100")
      .then((r) => r.json())
      .then((data) => setTags(data.tags ?? []))
      .catch(() => setTags([]));
  }, []);

  function toggleInterest(name: string) {
    const key = interestKey(name);
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addCustomHashtag() {
    const raw = newHashtag.trim().replace(/^#+/, "").replace(/\s+/g, " ");
    if (!raw) return;
    const key = interestKey(raw);
    if (HIDDEN_INTERESTS.has(key)) {
      setNewHashtag("");
      return;
    }
    const basicMatch = BASIC_INTERESTS.find((n) => interestKey(n) === key);
    if (basicMatch) {
      setSelectedNames((prev) => new Set(prev).add(interestKey(basicMatch)));
      setNewHashtag("");
      return;
    }
    setCustomNames((prev) => (prev.some((n) => interestKey(n) === key) ? prev : [...prev, raw]));
    setSelectedNames((prev) => new Set(prev).add(key));
    setNewHashtag("");
  }

  function removeCustomHashtag(name: string) {
    const key = interestKey(name);
    setCustomNames((prev) => prev.filter((n) => interestKey(n) !== key));
    setSelectedNames((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!ageConfirmed) {
      setError("You must confirm you are 16 years or older to sign up.");
      return;
    }
    if (password !== retypePassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const tagIds: string[] = [];
      const tagNames: string[] = [];
      for (const key of selectedNames) {
        const match = tags.find((t) => interestKey(t.name) === key);
        if (match) tagIds.push(match.id);
        else tagNames.push(key);
      }
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          city: normalizeResidentCity(city).trim() || undefined,
          tagIds,
          tagNames,
          ...(refCode && { ref: refCode }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      const message = typeof data?.error === "string" ? data.error : "Sign up failed. Please try again.";
      if (!res.ok) {
        setError(message);
        return;
      }
      if (data?.requiresEmailVerification === true) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(afterSignup)}&verifyPending=1&plan=subscribe&email=${encodeURIComponent(email.trim())}`;
        return;
      }
      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (signInRes?.ok) {
        window.location.href = afterSignup;
        return;
      }
      window.location.href = `/login?fromSignup=1&callbackUrl=${encodeURIComponent(afterSignup)}`;
    } catch {
      setError("Could not reach the server. Check your connection and that the app is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex-1 w-full" style={{ backgroundColor: "#FAF6EE" }}>
      <div className="max-w-lg mx-auto px-4 py-10 md:py-14">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 h-28 w-28 overflow-hidden rounded-full">
            <Image
              src="/nwc-logo-circle-crop.png"
              alt="Northwest Community"
              width={112}
              height={112}
              className="h-full w-full object-cover"
            />
          </div>
          <h1
            className="text-3xl md:text-4xl font-bold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Sign Up
          </h1>
          <p className="mt-2 text-sm md:text-base leading-relaxed" style={{ color: "var(--color-text)" }}>
            Create your free resident account and join the Inland Northwest community.
          </p>
        </div>

        <Link
          href="/support-nwc"
          className="group mb-8 flex items-center gap-4 rounded-2xl px-5 py-5 text-left shadow-sm transition-colors hover:bg-[var(--color-secondary)]"
          style={{ backgroundColor: "var(--color-primary)", color: "var(--color-button-text)" }}
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15">
            <IonIcon name="storefront-outline" size={26} />
          </span>
          <span className="min-w-0 flex-1">
            <span
              className="block text-base md:text-lg font-semibold leading-snug"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Local business owner, seller, or artisan?
            </span>
            <span className="mt-1 block text-sm md:text-base font-medium text-white/90">
              Join NWC as a local business!
            </span>
          </span>
          <IonIcon name="chevron-forward" size={22} className="shrink-0 opacity-80" />
        </Link>

        <div className="relative mb-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-[var(--color-primary)]/20" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-primary)]/70">
            or
          </span>
          <div className="h-px flex-1 bg-[var(--color-primary)]/20" />
        </div>

        <div
          className="rounded-2xl border bg-white p-6 md:p-8 shadow-sm"
          style={{ borderColor: "rgba(80, 85, 66, 0.15)" }}
        >
          <h2
            className="text-xl font-semibold mb-1"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Sign Up as Resident
          </h2>
          <p className="text-sm mb-6" style={{ color: "var(--color-text)" }}>
            Free to join. Add your city and interests so we can personalize your feed.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium mb-1">
                  First name
                </label>
                <input
                  id="firstName"
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoComplete="given-name"
                  className={fieldClass}
                />
              </div>
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium mb-1">
                  Last name
                </label>
                <input
                  id="lastName"
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  required
                  autoComplete="family-name"
                  className={fieldClass}
                />
              </div>
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="retypePassword" className="block text-sm font-medium mb-1">
                Retype password
              </label>
              <input
                id="retypePassword"
                type="password"
                value={retypePassword}
                onChange={(e) => setRetypePassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className={fieldClass}
              />
            </div>
            <div>
              <label htmlFor="city" className="block text-sm font-medium mb-1">
                City of residence (optional)
              </label>
              <CityPicker
                id="city"
                value={city}
                onChange={setCity}
                placeholder="Search or select city (e.g. Coeur d'Alene)"
                className={fieldClass}
              />
              <p className="text-xs text-gray-500 mt-1">
                Same city list as business profiles. Type a city and leave the field to save a custom city if yours is not listed.
              </p>
            </div>
            <div className="flex items-start gap-2">
              <input
                id="ageConfirmed"
                type="checkbox"
                checked={ageConfirmed}
                onChange={(e) => setAgeConfirmed(e.target.checked)}
                required
                className="mt-1 h-4 w-4 rounded accent-[var(--color-primary)]"
              />
              <label htmlFor="ageConfirmed" className="text-sm leading-snug">
                I confirm I am 16 years or older (users under 18 need parent/guardian permission).
              </label>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                Pick a few interests (optional)
              </label>
              <p className="text-xs text-gray-500 mb-2">Posts with these tags will appear in your feed.</p>
              <div className="flex flex-wrap gap-2">
                {BASIC_INTERESTS.map((name) => {
                  const selected = selectedNames.has(interestKey(name));
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => toggleInterest(name)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        selected
                          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                          : "border-[var(--color-primary)]/25 bg-white hover:bg-[var(--color-section-alt)]"
                      }`}
                    >
                      #{name}
                    </button>
                  );
                })}
                {customNames.map((name) => (
                  <button
                    key={`custom-${name}`}
                    type="button"
                    onClick={() => removeCustomHashtag(name)}
                    className="px-3 py-1.5 rounded-full text-sm border border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                    title="Remove"
                  >
                    #{name} ×
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  id="customHashtag"
                  type="text"
                  value={newHashtag}
                  onChange={(e) => setNewHashtag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addCustomHashtag();
                    }
                  }}
                  placeholder="Add your own hashtag"
                  maxLength={40}
                  className={fieldClass}
                />
                <button
                  type="button"
                  onClick={addCustomHashtag}
                  className="btn-outline shrink-0 px-4"
                >
                  Add
                </button>
              </div>
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <p className="text-sm text-gray-600">
              By signing up, you agree to our{" "}
              <Link href="/terms" className="underline hover:no-underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="underline hover:no-underline">
                Privacy Policy
              </Link>
              .
            </p>
            <button type="submit" className="btn w-full py-3" disabled={loading}>
              {loading ? "Creating account…" : "Sign Up"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm">
          Already have an account?{" "}
          <Link
            href={`/login?callbackUrl=${encodeURIComponent(afterSignup)}`}
            className="font-semibold underline"
            style={{ color: "var(--color-primary)" }}
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="max-w-lg mx-auto px-4 py-12 text-center">Loading…</div>}>
      <SignupForm />
    </Suspense>
  );
}
