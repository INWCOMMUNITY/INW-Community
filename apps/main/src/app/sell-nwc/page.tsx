import Link from "next/link";
import { CheckoutButton } from "@/components/CheckoutButton";
import { InfoPageContact } from "@/components/InfoPageContact";
import { InfoPageHeader } from "@/components/InfoPageHeader";
import { InfoPageBenefitSections } from "@/components/InfoPageBenefitSections";
import { WIX_IMG, SELLER_INFO_BENEFIT_IMAGES, GALLERY_CTA_BACKGROUND } from "@/lib/wix-media";
import { InfoPageSignupBanner } from "@/components/InfoPageSignupBanner";

const SELLER_BENEFITS = [
  { title: "Everything in Sponsor NWC", description: "You get all Sponsor benefits: directory listing, coupons, event calendars, and visibility at NWC events.", imageSrc: WIX_IMG(SELLER_INFO_BENEFIT_IMAGES[0]), imageAlt: "Northwest Community" },
  { title: "Sell on Our Storefront", description: "List your products on the NWC online store. Shoppers can buy from you directly, and you get paid.", imageSrc: WIX_IMG(SELLER_INFO_BENEFIT_IMAGES[1]), imageAlt: "NWC storefront" },
  { title: "No Percentage Cuts", description: "NWC does not take a percentage of your sales. You keep what you earn from items sold through our platform.", imageSrc: WIX_IMG(SELLER_INFO_BENEFIT_IMAGES[2]), imageAlt: "Sell local" },
  { title: "Shop Local, Online", description: "Make it easy for people to support local from home. Your products reach customers who want to buy from Inland Northwest businesses.", imageSrc: WIX_IMG(SELLER_INFO_BENEFIT_IMAGES[3]), imageAlt: "Support local" },
  { title: "Full Access From Day One", description: "List your products and start selling on our storefront as soon as you sign up. No waiting period—get started right away.", imageSrc: WIX_IMG(SELLER_INFO_BENEFIT_IMAGES[4]), imageAlt: "Northwest Community" },
];

export default function SellNWCPage() {
  return (
    <>
      <InfoPageHeader
        title="Interested in Becoming a Northwest Community Seller?"
        description="Curious about the benefits Northwest Community offers to our Sellers? This page is here to answer your questions and demonstrate what we do for our sellers. Read our policy and sell and ship local goods from the comfort of your home or office. All sellers are also sponsors—see our sponsor benefits page as well."
        policyHref="/policies/nwc-seller"
        policyLabel="Local Seller Policy"
      />
      <InfoPageBenefitSections benefits={SELLER_BENEFITS} />

      <section className="py-12 px-12 md:px-20 lg:px-24" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4" style={{ color: "var(--color-heading)" }}>
            How It Works
          </h2>
          <p className="mb-10 opacity-80">
            Sign up, add your products, and start selling. NWC handles the storefront; you handle your inventory and fulfillment. Shoppers in Spokane and Kootenai County can discover and buy from you—supporting local has never been easier.
          </p>
        </div>
      </section>

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
            Local businesses and makers who want to sell online without losing customers to big-box retailers. If you have products to sell and want a platform that puts local first, Sell NWC is for you.
          </p>
        </div>
      </section>

      <InfoPageSignupBanner
        backgroundPath={GALLERY_CTA_BACKGROUND}
        heading="Become a Seller"
        planId="seller"
        buttonLabel="Sign Up Now"
      />

      <InfoPageContact />
      <section className="py-10 px-12 md:px-20 lg:px-24 text-center" style={{ padding: "var(--section-padding)" }}>
        <div className="flex flex-wrap gap-4 justify-center">
          <CheckoutButton planId="seller" className="btn">
            Become a Seller
          </CheckoutButton>
          <Link href="/support-nwc" className="btn-sponsors-light inline-block">
            Compare All Plans
          </Link>
        </div>
      </section>
    </>
  );
}
