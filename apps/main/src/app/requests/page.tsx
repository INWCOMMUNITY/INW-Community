import Link from "next/link";
import { Section } from "design-tokens";
import { NWCRequestsTrigger } from "@/components/NWCRequestsTrigger";

export default function RequestsPage() {
  return (
    <Section
      columns={[
        <div key="copy">
          <h1 className="text-3xl font-bold mb-2">NWC Requests</h1>
          <p className="text-gray-600 mb-6">
            Send a request or message to the Northwest Community team. Click the button below to open the form.
          </p>
          <div className="flex flex-wrap gap-4">
            <NWCRequestsTrigger />
            <Link href="/support-local" className="btn inline-block">
              Browse NWC Sponsors
            </Link>
          </div>
        </div>,
      ]}
      layout="single"
    />
  );
}
