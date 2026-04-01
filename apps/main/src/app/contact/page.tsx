import Link from "next/link";
import { NwcRequestFormBody } from "@/components/NwcRequestFormBody";

export const metadata = {
  title: "Contact | Northwest Community",
  description:
    "Contact Northwest Community — send a message or request to our team. For app users, account help, and general inquiries.",
};

export default function ContactPage() {
  return (
    <section className="flex-1 py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto w-full">
        <div className="max-w-2xl mx-auto">
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Link href="/" className="text-sm text-gray-600 hover:underline">
              ← Northwest Community
            </Link>
          </div>
          <h1 className="text-3xl font-bold mb-2">Contact</h1>
          <p className="text-gray-600 mb-8">
            Use this form to reach the Northwest Community team — for example app feedback, account questions, or other
            requests. We respond by email.
          </p>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8">
            <NwcRequestFormBody showSubject />
          </div>
        </div>
      </div>
    </section>
  );
}
