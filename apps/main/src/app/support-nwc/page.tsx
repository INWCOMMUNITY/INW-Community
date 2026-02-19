"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";
import { WIX_IMG } from "@/lib/wix-media";
import { CheckoutButton } from "@/components/CheckoutButton";
import { useSiteImageUrls } from "@/components/SiteImageUrls";

const PLANS = [
  {
    id: "subscribe",
    name: "Northwest Community Subscription",
    price: 10,
    priceYearly: 100,
    description:
      "This plan helps support our business and what we do, as well as provides access to our coupons, access to exclusive groups, and gets you exclusive hints in our scavenger hunts!",
    imagePath: "2bdd49_7de70ff63f78486392f92fbd40c8c73e~mv2.jpg/v1/fill/w_400,h_300,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_7de70ff63f78486392f92fbd40c8c73e~mv2.jpg",
    benefitsHref: "/subscribe-nwc",
    benefitsLabel: "Subscriber Benefits",
  },
  {
    id: "sponsor",
    name: "Northwest Community Business",
    price: 25,
    priceYearly: 250,
    description:
      "Join Northwest Community's Local Business Directory. Offer coupons, post events on our calendar, and gain visibility through the events NWC will put on.",
    imagePath: "2bdd49_e16f54dfbbf44525bf5a7dca343a7e03~mv2.jpg/v1/fill/w_400,h_300,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_e16f54dfbbf44525bf5a7dca343a7e03~mv2.jpg",
    benefitsHref: "/sponsor-nwc",
    benefitsLabel: "Sponsor Benefits",
  },
  {
    id: "seller",
    name: "Northwest Community Seller",
    price: 40,
    priceYearly: 400,
    description:
      "Become a Sponsor as well as gain access to sell on our online storefront as a local business! List items personally and get paid, without NWC taking personal percentages from your sold items.",
    imagePath: "2bdd49_85a6f874c20a4f1db5abfb6f3d9b9bdb~mv2.jpg/v1/fill/w_400,h_300,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/2bdd49_85a6f874c20a4f1db5abfb6f3d9b9bdb~mv2.jpg",
    benefitsHref: "/sell-nwc",
    benefitsLabel: "Seller Benefits",
  },
];

export default function SupportNWCInfoPage() {
  const [interval, setInterval] = useState<"monthly" | "yearly">("monthly");
  const siteImages = useSiteImageUrls();

  return (
    <>
    <section className="py-12 px-6 md:px-4" style={{ padding: "var(--section-padding)" }}>
      <div className="max-w-[var(--max-width)] mx-auto">
        <div className="text-center mb-10">
          <Image
            src={siteImages["nwc-logo-circle"] ?? cloudinaryFetchUrl("/nwc-logo-circle.png")}
            alt="Northwest Community"
            width={160}
            height={160}
            className="mx-auto mb-6 rounded-full object-cover"
            quality={100}
          />
          {/* Plan: header font -30% on mobile */}
          <h1 className="text-[2.1rem] md:text-3xl font-bold mb-2" style={{ color: "var(--color-heading)" }}>
            NWC Services: Subscribe, Sponsor, or Sell!
          </h1>
          <p className="text-xl opacity-80 max-w-2xl mx-auto">
            Northwest Community is a local hub for the Inland Northwest—Spokane, Kootenai County, and beyond. Choose the plan that fits you below. Each subscription supports our mission and comes with real benefits.
          </p>

          <div className="flex justify-center gap-2 mt-6">
            <button
              type="button"
              onClick={() => setInterval("monthly")}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                interval === "monthly"
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval("yearly")}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                interval === "yearly"
                  ? "bg-[var(--color-primary)] text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              Yearly
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="border-2 border-[var(--color-primary)] rounded-lg overflow-hidden flex flex-col bg-white"
            >
              <div className="w-full aspect-[4/3] shrink-0 bg-gray-100">
                <img
                  src={cloudinaryFetchUrl(WIX_IMG(plan.imagePath))}
                  alt=""
                  className="w-full h-full object-cover"
                  sizes="(max-width: 768px) 100vw, 33vw"
                />
              </div>
              <div className="p-6 flex flex-col flex-1">
              <h2 className="text-xl font-bold mb-2 text-gray-900">
                {plan.name}
              </h2>
              {interval === "monthly" ? (
                <p className="text-3xl font-bold mb-1 text-gray-900">
                  ${plan.price}
                  <span className="text-base font-normal opacity-80 text-gray-700"> / month</span>
                </p>
              ) : (
                <p className="text-3xl font-bold mb-1 text-gray-900">
                  ${plan.priceYearly}
                  <span className="text-base font-normal opacity-80 text-gray-700"> / year</span>
                </p>
              )}
              <p className="text-sm mb-3 opacity-90 text-gray-900">{plan.description}</p>
              <p className="text-xs opacity-70 mb-2 text-gray-700">Valid until canceled</p>
              <CheckoutButton
                planId={plan.id}
                interval={interval}
                className="btn w-full text-center inline-block mb-4"
              >
                Subscribe
              </CheckoutButton>
              <Link
                href={plan.benefitsHref}
                className="btn w-full text-center inline-block"
                style={{ backgroundColor: "var(--color-primary)", color: "var(--color-button-text)" }}
              >
                {plan.benefitsLabel}
              </Link>
              </div>
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-600 max-w-2xl mx-auto text-center mb-6">
          By subscribing, you agree to our{" "}
          <Link href="/terms" className="underline" style={{ color: "var(--color-primary)" }}>Terms of Service</Link>
          {" "}and{" "}
          <Link href="/privacy" className="underline" style={{ color: "var(--color-primary)" }}>Privacy Policy</Link>.
          Subscriptions automatically renew. You will be charged each {interval === "monthly" ? "month" : "year"} until you cancel. Cancel anytime via{" "}
          <Link href="/my-community/subscriptions" className="underline" style={{ color: "var(--color-primary)" }}>
            My Community → Subscriptions
          </Link>{" "}
          (or from the Manage Subscription link after signing in).
        </p>
      </div>
    </section>

      {/* Why Northwest Community – full-bleed background photo wall-to-wall */}
      <section className="relative w-full min-h-[720px] flex items-center justify-center overflow-hidden mt-12">
        <img
          src={siteImages["why-nwc-background"] ?? "/why-nwc-background.png"}
          alt=""
          className="absolute inset-0 w-full h-full object-cover object-[55%_50%] md:object-[50%_85%] min-w-full min-h-full"
        />
        <div className="relative z-10 max-w-2xl mx-auto px-6 py-12 text-center">
          <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-8 md:p-10">
            <h2 className="text-2xl font-bold mb-4 text-gray-900">
              Why Northwest Community?
            </h2>
            <p className="mb-4 opacity-90 text-gray-700">
              We connect local businesses and people in Eastern Washington and North Idaho. Our goal is to make supporting local easy—whether you&apos;re a shopper, a business owner, or a community member. Subscriptions and sponsorships help us run events, giveaways, and keep this platform free for everyone.
            </p>
            <p className="opacity-90 text-gray-700">
              Have questions? Check out the detailed pages for Subscribe, Sponsor, and Sell above, or reach out. We&apos;re here to help.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
