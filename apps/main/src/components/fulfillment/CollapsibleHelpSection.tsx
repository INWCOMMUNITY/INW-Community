"use client";

import Link from "next/link";
import { CollapsibleListingSection } from "@/components/store-item/CollapsibleListingSection";

type CollapsibleHelpSectionProps = {
  shippingSetupHref: string;
};

export function CollapsibleHelpSection({ shippingSetupHref }: CollapsibleHelpSectionProps) {
  return (
    <CollapsibleListingSection
      title="How shipping works"
      subtitle="Labels, packing slips, and mark-shipped without a label."
      icon="help-circle-outline"
      defaultExpanded={false}
    >
      <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
        <li>Select orders on the Ship tab, then purchase labels in the full-screen Shippo tool.</li>
        <li>Orders from the same buyer are combined into one Shippo checkout per buyer.</li>
        <li>Print packing slips from the action bar using the same selection.</li>
        <li>
          If you shipped with your own carrier, use <strong>Mark shipped (no label)</strong> on each
          order card.
        </li>
      </ul>
      <Link href={shippingSetupHref} className="text-sm font-medium hover:underline inline-block mt-3" style={{ color: "var(--color-link)" }}>
        Shipping setup →
      </Link>
    </CollapsibleListingSection>
  );
}
