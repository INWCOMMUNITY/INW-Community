import Link from "next/link";
import { CheckoutButton } from "@/components/CheckoutButton";
import { InfoPageContact } from "@/components/InfoPageContact";
import { InfoPageHeader } from "@/components/InfoPageHeader";
import { InfoPageBenefitSections } from "@/components/InfoPageBenefitSections";
import { WIX_IMG, SUBSCRIBER_INFO_BENEFIT_IMAGES, GALLERY_CTA_BACKGROUND } from "@/lib/wix-media";
import { InfoPageSignupBanner } from "@/components/InfoPageSignupBanner";

const SUBSCRIBER_BENEFITS = [
  { title: "Access to NWC Coupons", description: "Redeem discounts at local businesses in our coupon book. Save money while supporting local.", imageSrc: WIX_IMG(SUBSCRIBER_INFO_BENEFIT_IMAGES[0]), imageAlt: "NWC coupons" },
  { title: "Exclusive Groups", description: "Join subscriber-only groups where you can connect with other community-minded people in the Inland Northwest.", imageSrc: WIX_IMG(SUBSCRIBER_INFO_BENEFIT_IMAGES[1]), imageAlt: "Community groups" },
  { title: "Scavenger Hunt Hints", description: "Get exclusive hints for NWC scavenger hunts and community challenges. Increase your chances of winning prizes.", imageSrc: WIX_IMG(SUBSCRIBER_INFO_BENEFIT_IMAGES[2]), imageAlt: "NWC events" },
  { title: "Support Our Mission", description: "Your subscription helps us put on events, create raffles, and offer incentives that bring the community together.", imageSrc: WIX_IMG(SUBSCRIBER_INFO_BENEFIT_IMAGES[3]), imageAlt: "Northwest Community" },
  { title: "This Site Stays Free", description: "Northwest Community is free for everyone. Subscribing is optional—but if you want to support what we do and unlock these benefits, we appreciate you.", imageSrc: WIX_IMG(SUBSCRIBER_INFO_BENEFIT_IMAGES[4]), imageAlt: "Northwest Community" },
];

export default function SubscribeNWCPage() {
  return (
    <>
      <InfoPageHeader
        title="Interested in Subscribing to Northwest Community?"
        description="Curious about the benefits Northwest Community offers to our subscribers? This page is here to answer your questions and demonstrate what we do for our subscribers. Read our policy and learn how you can gain access to coupons, exclusive giveaways, exclusive events, and hints to our scavenger hunts!"
        policyHref="/policies/nwc-subscriber"
        policyLabel="NWC Subscriber Policy"
      />
      <InfoPageBenefitSections benefits={SUBSCRIBER_BENEFITS} />

      <section
        className="w-full py-16 md:py-24 px-6 md:px-10"
        style={{ backgroundColor: "var(--color-section-alt)", minHeight: "320px" }}
      >
        <div className="max-w-3xl mx-auto text-center">
          {/* Plan: Who is this for – title -40%, paragraph -20% on mobile */}
          <h2 className="text-[1.35rem] md:text-4xl font-bold mb-6" style={{ color: "var(--color-heading)" }}>
            Who Is This For?
          </h2>
          <p className="text-base md:text-xl opacity-90 leading-relaxed">
            Residents of Eastern Washington and North Idaho who want to support local and get something back. If you believe in shopping local, connecting with your community, and participating in fun events, Subscribe NWC is for you.
          </p>
        </div>
      </section>

      <InfoPageSignupBanner
        backgroundPath={GALLERY_CTA_BACKGROUND}
        heading="Become a Subscriber"
        planId="subscribe"
        buttonLabel="Sign Up Now"
      />

      <InfoPageContact />
      <section className="py-10 px-12 md:px-20 lg:px-24 text-center" style={{ padding: "var(--section-padding)" }}>
        <div className="flex flex-wrap gap-4 justify-center">
          <CheckoutButton planId="subscribe" className="btn">
            Subscribe to Northwest Community
          </CheckoutButton>
          <Link href="/support-nwc" className="btn-sponsors-light inline-block">
            Compare All Plans
          </Link>
        </div>
      </section>
    </>
  );
}
