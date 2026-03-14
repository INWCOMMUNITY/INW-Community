import Link from "next/link";
import { ResaleHubShippingPolicy } from "@/components/ResaleHubShippingPolicy";

export default function ResaleHubPoliciesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Policies</h1>
      <p className="text-gray-600 mb-6">
        Set your shipping, local delivery, and pickup policies for your resale listings. These are synced when you list or edit an item.
      </p>
      <ResaleHubShippingPolicy />
      <div className="mt-8 pt-6 border-t border-gray-200">
        <Link href="/resale-hub" className="text-[var(--color-link)] hover:underline font-medium">
          ← Back to Resale Hub
        </Link>
      </div>
    </div>
  );
}
