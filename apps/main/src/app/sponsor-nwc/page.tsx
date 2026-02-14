import Link from "next/link";
import { CheckoutButton } from "@/components/CheckoutButton";
import { InfoPageContact } from "@/components/InfoPageContact";
import { InfoPageHeader } from "@/components/InfoPageHeader";
import { InfoPageBenefitSections } from "@/components/InfoPageBenefitSections";
import { WIX_IMG, SPONSOR_INFO_BENEFIT_IMAGES, GALLERY_CTA_BACKGROUND } from "@/lib/wix-media";
import { InfoPageSignupBanner } from "@/components/InfoPageSignupBanner";

const SPONSOR_BENEFITS = [
  { title: "Local Business Directory Listing", description: "Your business appears in our Support Local directory, visible to residents of Spokane and Kootenai County who want to support local.", imageSrc: WIX_IMG(SPONSOR_INFO_BENEFIT_IMAGES[0]), imageAlt: "Support Local directory" },
  { title: "Offer Coupons", description: "Add coupons to the NWC coupon book. Subscribers can redeem your discounts, driving traffic and loyalty to your business.", imageSrc: WIX_IMG(SPONSOR_INFO_BENEFIT_IMAGES[1]), imageAlt: "NWC coupons" },
  { title: "Post Events on Our Calendars", description: "Promote your events across our six community calendars: Fun Events, Local Art & Music, Non-Profit, Business Promo, Marketing, and Real Estate.", imageSrc: WIX_IMG(SPONSOR_INFO_BENEFIT_IMAGES[2]), imageAlt: "Event calendars" },
  { title: "Offer Rewards to the Community", description: "We as locally owned companies in Eastern Washington and North Idaho, want to team up and create incentives for residents in this area to support local vs corporate. Residents gain points for supporting local, and they can redeem points for rewards offered by NWC and Local Businesses in our area.", imageSrc: WIX_IMG(SPONSOR_INFO_BENEFIT_IMAGES[3]), imageAlt: "NWC community events" },
  { title: "Support the Community", description: "Your sponsorship helps NWC put on events, create incentives, and keep this platform free for everyone.", imageSrc: WIX_IMG(SPONSOR_INFO_BENEFIT_IMAGES[4]), imageAlt: "Northwest Community" },
];

export default function SponsorNWCPage() {
  return (
    <>
      <InfoPageHeader
        title="Interested in Becoming a Sponsor?"
        description="Curious what benefits Northwest Community offers to our Sponsors? This page is here to answer your questions and demonstrate what we do for our sponsors. Read our policy and tag along with what we are doing!"
        policyHref="/policies/nwc-sponsor"
        policyLabel="NWC Sponsor Policy"
      />
      <InfoPageBenefitSections benefits={SPONSOR_BENEFITS} />

      <section
        className="w-full py-16 md:py-24 px-12 md:px-20 lg:px-24 flex flex-col items-center justify-center"
        style={{ backgroundColor: "var(--color-section-alt)", minHeight: "320px" }}
      >
        <div className="w-full max-w-xl mx-auto text-center">
          {/* Plan: Who is this for – title -40%, paragraph -20% on mobile */}
          <h2 className="text-[1.35rem] md:text-4xl font-bold mb-6" style={{ color: "var(--color-heading)" }}>
            Who Is This For?
          </h2>
          <p className="text-base md:text-xl opacity-90 leading-relaxed">
            Local business owners, self-employed workers, and anyone who wants to reach customers in the Inland Northwest. If you believe in supporting local and want your business to be part of this community hub, Sponsor NWC is for you.
          </p>
        </div>
      </section>

      <InfoPageSignupBanner
        backgroundPath={GALLERY_CTA_BACKGROUND}
        heading="Become a Sponsor"
        planId="sponsor"
        buttonLabel="Sign Up Now"
      />

      <InfoPageContact />
      <section className="py-10 px-12 md:px-20 lg:px-24 text-center" style={{ padding: "var(--section-padding)" }}>
        <div className="flex flex-wrap gap-4 justify-center">
          <CheckoutButton planId="sponsor" className="btn">
            Become a Sponsor
          </CheckoutButton>
          <Link href="/support-nwc" className="btn-sponsors-light inline-block">
            Compare All Plans
          </Link>
        </div>
      </section>
    </>
  );
}
