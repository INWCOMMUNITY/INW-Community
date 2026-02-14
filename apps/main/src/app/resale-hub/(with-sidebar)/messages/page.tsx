import Link from "next/link";

export default function ResaleHubMessagesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">My Messages</h1>
      <p className="text-gray-600 mb-6">
        Conversations with buyers about your resale listings.
      </p>
      <Link
        href="/my-community/messages"
        className="btn inline-block"
      >
        Open My Messages
      </Link>
      <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline mt-6 ml-4 inline-block">
        Back to Resale Hub
      </Link>
    </div>
  );
}
