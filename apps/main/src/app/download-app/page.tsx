import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { DownloadAppStoreButtons } from "@/components/DownloadAppStoreButtons";
import { getSiteImageUrl } from "@/lib/site-images";
import {
  getAndroidPlayStoreUrl,
  getIosAppStoreUrl,
} from "@/lib/app-store-urls";

export const metadata: Metadata = {
  title: "Download the INW Community App | Northwest Community",
  description:
    "Download the INW Community App for reward points, supporting local businesses, community groups, calendars, coupons, local goods, and more in the Inland Northwest.",
};

export default async function DownloadAppPage() {
  const iosUrl = getIosAppStoreUrl();
  const androidUrl = getAndroidPlayStoreUrl();
  const appLogoUrl = (await getSiteImageUrl("nwc-logo-circle")) ?? "/nwc-logo-circle.png";

  return (
    <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-2xl mx-auto text-center">
        <div className="mb-6">
          <Link href="/" className="text-sm text-gray-600 hover:underline">
            ← Northwest Community
          </Link>
        </div>

        <Image
          src={appLogoUrl}
          alt="Northwest Community"
          width={140}
          height={140}
          className="mx-auto mb-6 rounded-full object-cover"
          quality={100}
        />
        <h1 className="text-3xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)" }}>
          Download the INW Community App
        </h1>
        <p className="text-gray-700 mb-10 leading-relaxed text-base sm:text-lg">
          Download the INW Community App on your phone to gain reward points, support our local
          businesses, join a community group, see our event calendars, access coupons, purchase
          local goods, and more. Support the businesses and people of the beautiful Inland
          Northwest!
        </p>

        <div className="max-w-md mx-auto w-full">
          <DownloadAppStoreButtons iosUrl={iosUrl} androidUrl={androidUrl} />
        </div>
      </div>
    </section>
  );
}
