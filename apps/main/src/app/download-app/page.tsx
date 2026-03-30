import type { Metadata } from "next";
import Link from "next/link";
import { DownloadAppStoreButtons } from "@/components/DownloadAppStoreButtons";
import {
  getAndroidPlayStoreUrl,
  getIosAppStoreUrl,
} from "@/lib/app-store-urls";

export const metadata: Metadata = {
  title: "Download App | Northwest Community",
  description:
    "Download the INW Community app for iPhone or Android — connect locally, support businesses, and earn rewards.",
};

export default function DownloadAppPage() {
  const iosUrl = getIosAppStoreUrl();
  const androidUrl = getAndroidPlayStoreUrl();

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-md mx-auto text-center">
        <div className="mb-6">
          <Link href="/" className="text-sm text-gray-600 hover:underline">
            ← Northwest Community
          </Link>
        </div>

        <h1 className="text-3xl font-bold mb-3" style={{ fontFamily: "var(--font-heading)" }}>
          Download the app
        </h1>
        <p className="text-gray-700 mb-10 leading-relaxed">
          Get INW Community on your phone: local feed, events, storefront, rewards, and more for
          Eastern Washington and North Idaho.
        </p>

        <DownloadAppStoreButtons iosUrl={iosUrl} androidUrl={androidUrl} />

        {!androidUrl ? (
          <p className="mt-6 text-sm text-gray-500 leading-relaxed">
            The Android release is on the way. Check back here or follow Northwest Community for
            updates.
          </p>
        ) : null}
      </div>
    </section>
  );
}
