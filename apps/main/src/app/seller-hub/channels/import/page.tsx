import { Suspense } from "react";
import { ChannelImportContent } from "@/components/seller-hub/ChannelImportContent";

export const dynamic = "force-dynamic";

export default function SellerHubChannelImportPage() {
  return (
    <Suspense fallback={<p className="text-gray-500 text-center py-8">Loading…</p>}>
      <ChannelImportContent />
    </Suspense>
  );
}
