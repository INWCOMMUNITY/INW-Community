import Link from "next/link";
import Image from "next/image";
import { Section } from "design-tokens";
import { WIX_IMG, WIX_SUBSCRIBE_BACKGROUND, CALENDAR_IMAGES } from "@/lib/wix-media";
import { getSiteImageUrl } from "@/lib/site-images";
import { DownloadAppStoreButtons } from "@/components/DownloadAppStoreButtons";
import { getAndroidPlayStoreUrl, getIosAppStoreUrl } from "@/lib/app-store-urls";

/** Green background used by logo section and Goals section right column (match opacity). */
const SECTION_GREEN_BG = "rgba(80, 85, 66, 0.8)";

export default async function HomePage() {
  const founderThanksUrl = (await getSiteImageUrl("founder-thanks")) ?? "/founder-thanks.png?v=4";
  const heroBackgroundUrl = (await getSiteImageUrl("hero-background")) ?? "/hero-background.png";
  const appLogoUrl = (await getSiteImageUrl("nwc-logo-circle")) ?? "/nwc-logo-circle.png";
  const communityGoalsUrl = (await getSiteImageUrl("community-goals")) ?? "/community-goals.png";
  const iosAppStoreUrl = getIosAppStoreUrl();
  const androidPlayStoreUrl = getAndroidPlayStoreUrl();
  return (
    <>
      <section className="relative flex flex-col items-center justify-center px-4 py-12 text-center overflow-hidden bg-[#F5E9D3] md:min-h-[85vh] md:py-16 md:bg-transparent">
        {/* Background photo — desktop only; mobile hero is logo on solid cream */}
        <div
          className="absolute inset-0 hidden bg-cover bg-center md:block"
          style={{ backgroundImage: `url(${heroBackgroundUrl})` }}
          aria-hidden
        />
        <div className="relative z-10 max-w-[var(--max-width)] mx-auto w-full">
          <div className="relative mx-auto aspect-square w-[min(100%,min(92vw,420px))] md:hidden">
            <Image
              src="/nwc-hero-logo.png"
              alt="Northwest Community"
              fill
              className="object-contain"
              sizes="92vw"
              priority
            />
          </div>
          <div className="hidden md:block">
            <div
              className="mx-auto max-w-2xl rounded-xl border-2 px-8 py-8 md:px-10 md:py-10 text-center"
              style={{
                backgroundColor: "rgba(245, 233, 211, 0.8)",
                borderColor: "var(--color-primary)",
              }}
            >
              <h1
                className="text-4xl md:text-5xl font-bold mb-4"
                style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
              >
                Northwest Community
              </h1>
              <p className="text-lg mb-4 leading-relaxed" style={{ color: "var(--color-text)" }}>
                Connecting the good people of Spokane & Kootenai County through our community feed and messaging, selling local goods, event calendars, NWC Requests, local coupons, and of course, fun events that bring the community together and support the beautiful Northwest we live in. This website is for residents of the Inland Northwest, a region of the beautiful PNW. Welcome, residents of Eastern Washington and North Idaho. This is your one-stop shop for supporting locally owned businesses and local people.
              </p>
              <Link href="/signup" className="btn inline-block">
                Join Now
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section
        className="w-full py-12 px-6 md:px-8 border-t-2 border-b-2 bg-white"
        style={{ borderColor: SECTION_GREEN_BG }}
      >
        <div className="max-w-2xl mx-auto text-center">
          <Image
            src={appLogoUrl}
            alt="Northwest Community"
            width={140}
            height={140}
            className="mx-auto mb-6 rounded-full object-cover"
            quality={100}
          />
          <h2
            className="text-2xl md:text-3xl font-bold mb-4"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Download the INW Community App
          </h2>
          <p className="text-lg mb-8 leading-relaxed" style={{ color: "var(--color-text)" }}>
            Download the INW Community App on your phone to gain reward points, support our local
            businesses, join a community group, see our event calendars, access coupons, purchase
            local goods, and more. Support the businesses and people of the beautiful Inland
            Northwest!
          </p>
          <div className="w-full max-w-md mx-auto md:max-w-3xl">
            <DownloadAppStoreButtons
              iosUrl={iosAppStoreUrl}
              androidUrl={androidPlayStoreUrl}
              variant="home"
            />
          </div>
        </div>
      </section>

      <section
        className="grid grid-cols-1 md:grid-cols-2 min-w-0 w-full max-w-none items-center border-b-2"
        style={{ borderColor: SECTION_GREEN_BG }}
      >
        <div className="bg-white py-12 px-6 md:px-8 md:pr-12 text-center">
          <h1 className="text-3xl md:text-4xl font-bold mb-1" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
            Northwest Community
          </h1>
          <h2 className="text-2xl font-semibold mb-4" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
            Goals
          </h2>
          <p className="text-lg font-medium mb-4" style={{ color: "var(--color-heading)" }}>
            Insuring that locally owned business in this area continue to thrive.
          </p>
          <p className="mb-6 max-w-xl mx-auto">
            Locally owned businesses and self-employed workers are a staple of the area we live in. Local businesses offer something more than an average corporate company can. Personal connection, honest business, and people being treated right are qualities this area cannot and will not lose. Northwest Community&apos;s goal is to continue connecting local clientele to the businesses that care. Whether it&apos;s shopping local from the comfort of your home, or using this platform to reach out to local businesses. We hope this website encourages you and me to support the businesses that support our community, ensuring our money goes back to people in the Inland Northwest. Thank you for being here!
          </p>
          <Link
            href="/about"
            className="inline-block px-6 py-2.5 rounded-lg bg-gray-200 text-[var(--color-heading)] font-medium border border-gray-400 hover:bg-gray-300 transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            About NWC
          </Link>
        </div>
        <div
          className="flex justify-center items-center p-6 md:p-8 md:pl-8 min-h-[280px] md:min-h-[340px] w-full"
          style={{ backgroundColor: SECTION_GREEN_BG }}
        >
          <Image
            src={communityGoalsUrl}
            alt="Northwest Community"
            className="rounded-lg object-cover object-bottom border-2 border-[var(--color-secondary)] w-[60%] max-w-[420px] aspect-square"
            width={420}
            height={420}
            sizes="(max-width: 768px) 100vw, 50vw"
            quality={95}
          />
        </div>
      </section>

      <section
        className="w-full py-12 px-6 md:px-8 border-b-2"
        style={{ backgroundColor: "#FDEDCC", borderColor: "#505542" }}
      >
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
            Are you a local business wanting to join Northwest Community?
          </h2>
          <p className="mb-6 max-w-xl mx-auto">
            Here is a shortcut to the Business subscription and registering your business information.
          </p>
          <Link href="/business-hub" className="btn-sponsors">Business Hub</Link>
        </div>
      </section>

      <Section
        columns={[
          <div key="events" className="text-center border-t-2 pt-6" style={{ borderColor: "#505542" }}>
            <h2 className="text-[38px] font-bold mb-6" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
              Northwest Community Calendars
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Link href="/calendars/fun_events" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={CALENDAR_IMAGES.fun_events} alt="Fun Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Fun Events Calendar</span>
              </Link>
              <Link href="/calendars/local_art_music" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={CALENDAR_IMAGES.local_art_music} alt="Local Art & Music" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Local Art & Music Calendar</span>
              </Link>
              <Link href="/calendars/non_profit" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={CALENDAR_IMAGES.non_profit} alt="Non-Profit Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Non-Profit Events Calendar</span>
              </Link>
              <Link href="/calendars/business_promotional" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={CALENDAR_IMAGES.business_promotional} alt="Community Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Community Events Calendar</span>
              </Link>
              <Link href="/calendars/marketing" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={CALENDAR_IMAGES.marketing} alt="Marketing Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Marketing Events Calendar</span>
              </Link>
              <Link href="/calendars/real_estate" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={CALENDAR_IMAGES.real_estate} alt="Real Estate Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Real Estate Events Calendar</span>
              </Link>
            </div>
          </div>,
        ]}
      />

      <section
        className="w-full py-12 px-6 md:px-8 border-t-2 border-b-2"
        style={{ backgroundColor: "#FDEDCC", borderColor: "#505542" }}
      >
        <div className="max-w-[var(--max-width)] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="text-center md:text-left">
            <h2 className="text-2xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
              Northwest Community Businesses
            </h2>
            <p className="mb-6">
              This community page is all about incentivizing supporting locally owned businesses in Eastern Washington & North Idaho. In fact this company cannot succeed without the support of these businesses, let us as a community support them back. Go check them out, save them as a favorite business, see the events they put on, or purchase items from the Northwest Community Storefront.
            </p>
            <div className="flex gap-3 flex-wrap justify-center md:justify-start">
              <Link href="/support-local" className="btn-sponsors text-sm py-1.5 px-3 md:text-base md:py-2 md:px-4">Support Local</Link>
              <Link href="/storefront" className="btn-sponsors text-sm py-1.5 px-3 md:text-base md:py-2 md:px-4">NWC Storefront</Link>
              <Link href="/support-nwc" className="btn-sponsors text-sm py-1.5 px-3 md:text-base md:py-2 md:px-4">Support NWC</Link>
            </div>
          </div>
          <div className="flex justify-center w-full">
            <div
              className="relative aspect-square w-full max-w-[420px] overflow-hidden rounded-lg border-2 border-[var(--color-primary)] p-2 md:p-3"
              style={{ backgroundColor: SECTION_GREEN_BG }}
            >
              <Image
                src={WIX_IMG("2bdd49_0061748f80f642939a6f4b70ddb4a27d~mv2.jpg/v1/fill/w_1449,h_1482,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Photo%20Nov%2007%202025%2C%208%2056%2020%20PM_edited_edited.jpg")}
                alt="Northwest Community"
                fill
                className="rounded-md object-cover"
                sizes="(max-width: 768px) 100vw, 420px"
                quality={95}
              />
            </div>
          </div>
        </div>
      </section>

      <section
        className="relative w-full min-h-[750px] py-16 px-6 md:px-8 border-t-2 border-b-2 overflow-hidden flex flex-col justify-start"
        style={{ borderColor: "#505542" }}
      >
        {/* Forest background image from Wix */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${WIX_IMG(WIX_SUBSCRIBE_BACKGROUND)})` }}
          aria-hidden
        />
        <div className="relative z-10 max-w-2xl mx-auto w-full">
          <div
            className="rounded-lg p-8 md:p-10 text-center border-2"
            style={{ backgroundColor: "rgba(253, 237, 204, 0.7)", borderColor: "#505542" }}
          >
            <h2 className="text-xl md:text-2xl font-bold mb-6 leading-tight" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
              <span className="block">Subscribe to</span>
              <span className="block">Northwest Community</span>
            </h2>
            <p className="mb-8 leading-relaxed" style={{ color: "var(--color-heading)" }}>
              Support what we are doing, but not without benefits! Northwest Community offers coupons to local businesses to incentivize supporting local. We will also do giveaways and prizes for our subscribers. Check out our coupon book, and stay tuned for giveaways, prizes, competitions to win money through NWC, and other benefits by being a subscriber. If you would like your company to get the Business plan or sell through our storefront, check out those benefits below. This site is free and will remain free, but if you feel like tagging along, we appreciate the support!
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/support-nwc" className="btn-sponsors">Subscribe</Link>
              <Link href="/coupons" className="btn-sponsors">Coupons</Link>
              <Link href="/rewards" className="btn-sponsors">Rewards</Link>
              <Link href="/badges" className="btn-sponsors">Badges</Link>
            </div>
          </div>
        </div>
      </section>

      <section
        className="grid grid-cols-1 md:grid-cols-2 min-w-0 w-full max-w-none items-stretch"
        style={{ backgroundColor: "#FFF8E1" }}
      >
        <div
          className="flex justify-center p-8 md:p-12 order-2 md:order-1 min-h-[320px] md:min-h-0 h-full"
          style={{ backgroundColor: "#FFF8E1" }}
        >
          <div className="relative max-w-xl w-full mx-auto h-full min-h-[280px] overflow-hidden rounded-lg border-2 border-[var(--color-secondary)]">
            <Image
              src={founderThanksUrl}
              alt="Northwest Community — pet area and local community"
              fill
              className="object-cover object-center"
              sizes="(max-width: 768px) 100vw, 576px"
              quality={100}
            />
          </div>
        </div>
        <div
          className="flex justify-center p-8 md:p-12 order-1 md:order-2 h-full"
          style={{ backgroundColor: "#FFF8E1" }}
        >
          <div
            className="p-8 md:p-10 max-w-xl w-full mx-auto bg-white border-0 h-full"
            style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }}
          >
            <h1 className="text-2xl md:text-3xl font-bold mb-4 text-left" style={{ fontFamily: "var(--font-heading)", color: "#333" }}>
              Hey! Thank you for being here!
            </h1>
            <p className="mb-4 leading-relaxed text-left" style={{ color: "#555" }}>
              We are a startup company established in 2025. It means the world to me when this site gets traffic, and I hope to see it blossom! I grew up in a locally owned business, supported by the people of this community. I want to see local businesses and local people succeed in this area. Coeur d&apos;Alene is my home, and I have been exploring the cities surrounding it my whole life. I want this community to remain a community. Just by you being here, reading this, we are already a step closer to making this website a valuable resource for the people of the Pacific Northwest! For that, I am thankful. Stay in touch for what this company will do, and watch us grow. Welcome to Northwest Community.
            </p>
            <p className="font-medium mb-6 text-left" style={{ color: "#555" }}>- Donivan Floyd</p>
            <Link
              href="/about"
              className="inline-block px-6 py-2.5 border-2 bg-white font-medium text-left transition-colors hover:bg-gray-50"
              style={{ borderColor: "#333", color: "var(--color-primary)" }}
            >
              Community Goals
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
