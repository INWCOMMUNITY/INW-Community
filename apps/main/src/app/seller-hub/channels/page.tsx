import { Suspense } from "react";
import { ChannelsSyncContent } from "@/components/seller-hub/ChannelsSyncContent";

export const dynamic = "force-dynamic";

export default function SellerHubChannelsPage() {
  return (
    <Suspense fallback={<p className="text-gray-500 text-center py-8">Loading…</p>}>
      <ChannelsSyncContent />
    </Suspense>
  );
}
