"use client";

import Link from "next/link";
import { CollapsibleListingSection } from "@/components/store-item/CollapsibleListingSection";

type CollapsibleHelpSectionProps = {
  shippingSetupHref: string;
};

export function CollapsibleHelpSection({ shippingSetupHref }: CollapsibleHelpSectionProps) {
  return (
    <CollapsibleListingSection
      title="How Shipping Works"
      subtitle="Labels and packing slips."
      icon="help-circle-outline"
      defaultExpanded={false}
    >
      <ul className="text-sm text-gray-600 space-y-2 list-disc pl-5">
        <li>Select orders on the Ship tab, then purchase labels in the full-screen Shippo tool.</li>
        <li>After you buy a label, stay on the Shippo print screen and use Print Shipping Label. Closing takes you to Shipped orders.</li>
        <li>Reprint Label opens the saved PDF. Repurchase Label starts a new purchase.</li>
        <li>Combine, or Combine eligible orders at the top, groups the orders you choose into one box on this page. An order you leave out stays on its own.</li>
        <li>Purchase Labels buys one Shippo label for each box, and one label for each order left out. Tracking for a box is saved on every order in that box.</li>
        <li>Print packing slips from the action bar. Each label gets one packing slip, including a box of several orders.</li>
      </ul>
      <Link href={shippingSetupHref} className="text-sm font-medium hover:underline inline-block mt-3" style={{ color: "var(--color-link)" }}>
        Shipping setup →
      </Link>
    </CollapsibleListingSection>
  );
}
