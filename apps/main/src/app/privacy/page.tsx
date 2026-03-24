import Link from "next/link";
import { PRIVACY_BODY, PRIVACY_LAST_UPDATED } from "@/lib/privacy-content";

export const metadata = {
  title: "Privacy Policy | Northwest Community",
  description: "Northwest Community privacy policy - how we collect, use, and protect your information.",
};

export default function PrivacyPage() {
  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto prose prose-gray max-w-none">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Link href="/" className="text-sm text-gray-600 hover:underline">
            ← Northwest Community
          </Link>
          <span className="text-gray-400">|</span>
          <a href="/api/policies/privacy/pdf" download className="text-sm" style={{ color: "var(--color-primary)" }}>
            Download PDF
          </a>
        </div>
        <h1 className="text-3xl font-bold mb-6">NORTHWEST COMMUNITY (NWC) – PRIVACY POLICY</h1>
        <p className="text-sm text-gray-500 mb-6">Last Updated: {PRIVACY_LAST_UPDATED}</p>

        <div className="whitespace-pre-wrap text-gray-700 leading-relaxed space-y-6">{PRIVACY_BODY}</div>
      </div>
    </section>
  );
}
