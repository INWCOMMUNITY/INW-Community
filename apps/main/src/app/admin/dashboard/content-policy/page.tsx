"use client";

import { useState, useMemo } from "react";
import {
  getRestrictedWordingForAdmin,
  validateText,
  containsProhibitedCategory,
  type ModerationContext,
} from "@/lib/content-moderation";

const CONTEXTS: { value: ModerationContext; label: string }[] = [
  { value: "comment", label: "Comment" },
  { value: "message", label: "Message" },
  { value: "product_title", label: "Product title" },
  { value: "product_description", label: "Product description" },
  { value: "business_name", label: "Business name" },
];

function getBlockReason(
  text: string,
  context: ModerationContext
): { allowed: boolean; reasons: string[] } {
  const result = validateText(text, context);
  const reasons: string[] = [];
  if (!result.allowed && result.reason) reasons.push(result.reason);
  if (
    (context === "product_title" || context === "product_description") &&
    containsProhibitedCategory(text, null, null)
  ) {
    reasons.push("Matches prohibited product category.");
  }
  const allowed = result.allowed && reasons.length === 0;
  return { allowed, reasons };
}

export default function ContentPolicyPage() {
  const lists = useMemo(() => getRestrictedWordingForAdmin(), []);
  const [testValue, setTestValue] = useState("");
  const [testContext, setTestContext] = useState<ModerationContext>("comment");
  const [testResult, setTestResult] = useState<{ allowed: boolean; reasons: string[] } | null>(null);

  const [quizWords] = useState(() => {
    const safe = ["B", "We", "hello", "the", "it", "assassin", "classic", "weird"];
    const all = [
      ...safe,
      ...lists.profanity,
      ...lists.slurs,
      ...lists.prohibitedCategories.slice(0, 6),
    ];
    return all.sort(() => Math.random() - 0.5);
  });
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizChoice, setQuizChoice] = useState<"allow" | "block" | null>(null);

  const currentQuizWord = quizWords[quizIndex];
  const quizSystemResult = currentQuizWord
    ? getBlockReason(currentQuizWord, "comment")
    : null;

  function runTest() {
    if (!testValue.trim()) {
      setTestResult(null);
      return;
    }
    setTestResult(getBlockReason(testValue.trim(), testContext));
  }

  return (
    <div className="max-w-3xl space-y-10">
      <h1 className="text-2xl font-bold">Content policy</h1>

      {/* Full list */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Restricted wording (read-only)</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded border p-4" style={{ borderColor: "#e5e3df" }}>
            <h3 className="font-medium mb-1">Prohibited product categories</h3>
            <p className="text-sm text-gray-600 mb-2">Store items & events: title, category, description</p>
            <ul className="text-sm list-disc list-inside">
              {lists.prohibitedCategories.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <div className="rounded border p-4" style={{ borderColor: "#e5e3df" }}>
            <h3 className="font-medium mb-1">Profanity</h3>
            <p className="text-sm text-gray-600 mb-2">Blocked in product title/description; business name triggers admin approval</p>
            <ul className="text-sm list-disc list-inside">
              {lists.profanity.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
          <div className="rounded border p-4" style={{ borderColor: "#e5e3df" }}>
            <h3 className="font-medium mb-1">Slurs</h3>
            <p className="text-sm text-gray-600 mb-2">Blocked in all contexts</p>
            <ul className="text-sm list-disc list-inside">
              {lists.slurs.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Test a word */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Test a word</h2>
        <p className="text-sm text-gray-600 mb-3">
          Run the same logic as the app. Use this to verify e.g. &quot;B&quot;, &quot;We&quot; are allowed after the fix.
        </p>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="text"
            value={testValue}
            onChange={(e) => {
              setTestValue(e.target.value);
              setTestResult(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && runTest()}
            placeholder="Type a word or phrase"
            className="border rounded px-3 py-2 w-56"
            style={{ borderColor: "#e5e3df" }}
          />
          <select
            value={testContext}
            onChange={(e) => {
              setTestContext(e.target.value as ModerationContext);
              setTestResult(null);
            }}
            className="border rounded px-3 py-2"
            style={{ borderColor: "#e5e3df" }}
          >
            {CONTEXTS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={runTest}
            className="px-4 py-2 rounded font-medium"
            style={{ backgroundColor: "#FDEDCC", color: "#3E432F" }}
          >
            Check
          </button>
        </div>
        {testResult !== null && (
          <div
            className={`mt-3 rounded p-3 ${testResult.allowed ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}
          >
            <strong>{testResult.allowed ? "Allowed" : "Blocked"}</strong>
            {testResult.reasons.length > 0 && (
              <ul className="mt-1 list-disc list-inside text-sm">
                {testResult.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Quiz */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Quiz</h2>
        <p className="text-sm text-gray-600 mb-3">
          For each word, choose whether you think it should be allowed or blocked. Then see what the system does.
        </p>
        {currentQuizWord ? (
          <div className="rounded border p-6" style={{ borderColor: "#e5e3df" }}>
            <p className="text-lg font-medium mb-4">Word: &quot;{currentQuizWord}&quot;</p>
            {quizChoice === null ? (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setQuizChoice("allow")}
                  className="px-4 py-2 rounded font-medium bg-green-100 text-green-800 hover:bg-green-200"
                >
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => setQuizChoice("block")}
                  className="px-4 py-2 rounded font-medium bg-amber-100 text-amber-800 hover:bg-amber-200"
                >
                  Block
                </button>
              </div>
            ) : (
              <div>
                <p className="mb-2">
                  You said: <strong>{quizChoice === "allow" ? "Allow" : "Block"}</strong>
                </p>
                <p className="mb-2">
                  System says:{" "}
                  <strong>{quizSystemResult?.allowed ? "Allowed" : "Blocked"}</strong>
                  {quizSystemResult?.reasons && quizSystemResult.reasons.length > 0 && (
                    <span className="text-sm font-normal"> — {quizSystemResult.reasons.join(" ")}</span>
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setQuizChoice(null);
                    setQuizIndex((i) => (i + 1) % quizWords.length);
                  }}
                  className="mt-2 px-4 py-2 rounded font-medium"
                  style={{ backgroundColor: "#FDEDCC", color: "#3E432F" }}
                >
                  Next word
                </button>
              </div>
            )}
          </div>
        ) : null}
        <p className="text-sm text-gray-500 mt-2">
          Word {quizIndex + 1} of {quizWords.length}
        </p>
      </section>
    </div>
  );
}
