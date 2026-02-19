import Link from "next/link";
import Image from "next/image";
import { Section } from "design-tokens";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";
import { WIX_IMG, WIX_HERO_GALLERY, WIX_SUBSCRIBE_BACKGROUND, CALENDAR_IMAGES } from "@/lib/wix-media";
import { getSiteImageUrl } from "@/lib/site-images";

export default async function HomePage() {
  const thanksLandscapeUrl = await getSiteImageUrl("thanks-landscape");
  return (
    <>
      <section className="relative min-h-[85vh] flex flex-col items-center justify-center px-4 py-16 text-center overflow-hidden">
        {/* Background image with brightness and clarity enhancement */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${cloudinaryFetchUrl(WIX_IMG(WIX_HERO_GALLERY))})`,
            filter: "brightness(1.2) contrast(1.1) saturate(1.05)",
          }}
          aria-hidden
        />
        {/* Light overlay for text contrast */}
        <div
          className="absolute inset-0 bg-black/30"
          aria-hidden
        />
        <div className="relative z-10 max-w-[var(--max-width)] mx-auto">
          <h1
            className="text-4xl md:text-5xl font-bold mb-4 text-white"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Northwest Community
          </h1>
          <p className="text-lg max-w-2xl mx-auto mb-8 text-white/95 leading-relaxed">
            Connecting the good people of Spokane & Kootenai County through our community feed and messaging, selling local goods, event calendars, NWC Requests, local coupons, and of course, fun events that bring the community together and support the beautiful Northwest we live in. This website is for residents of the Inland Northwest, a region of the beautiful PNW. Welcome, residents of Eastern Washington and North Idaho. This is your one-stop shop for supporting locally owned businesses and local people.
          </p>
          <Link
            href="/signup"
            className="inline-block px-8 py-3 rounded-lg bg-gray-400/80 text-white font-medium border-2 border-white hover:bg-gray-500/90 transition-colors"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Join Now
          </Link>
        </div>
      </section>

      <section
        className="grid grid-cols-1 md:grid-cols-2 min-w-0 w-full max-w-none items-center border-t-2 border-b-2"
        style={{ borderColor: "rgba(80, 85, 66, 0.8)" }}
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
          className="flex justify-center items-center p-6 md:p-8 md:pl-8 min-h-[400px] md:min-h-[500px] w-full"
          style={{ backgroundColor: "rgba(80, 85, 66, 0.8)" }}
        >
          <Image
            src={cloudinaryFetchUrl(WIX_IMG("2bdd49_9e1e39816a194b7d9e3557eb8a025cad~mv2.jpg/v1/fill/w_1400,h_1446,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Photo%20Nov%2007%202025%2C%209%2033%2002%20PM.jpg"))}
            alt="Northwest Community"
            className="rounded-lg object-cover border-2 border-[var(--color-secondary)]"
            width={934}
            height={964}
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
            Are you a Local Business wanting to Sponsor Northwest Community?
          </h2>
          <p className="mb-6 max-w-xl mx-auto">
            Look no further, here is a shortcut to registering a Sponsor for this company. As well as registering your business information.
          </p>
          <Link href="/sponsor-hub" className="btn-sponsors">Sponsor Northwest Community</Link>
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
                <Image src={cloudinaryFetchUrl(CALENDAR_IMAGES.fun_events)} alt="Fun Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Fun Events Calendar</span>
              </Link>
              <Link href="/calendars/local_art_music" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={cloudinaryFetchUrl(CALENDAR_IMAGES.local_art_music)} alt="Local Art & Music" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Local Art & Music Calendar</span>
              </Link>
              <Link href="/calendars/non_profit" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={cloudinaryFetchUrl(CALENDAR_IMAGES.non_profit)} alt="Non-Profit Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Non-Profit Events Calendar</span>
              </Link>
              <Link href="/calendars/business_promotional" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={cloudinaryFetchUrl(CALENDAR_IMAGES.business_promotional)} alt="Business Promo" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Business Promo Events Calendar</span>
              </Link>
              <Link href="/calendars/marketing" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={cloudinaryFetchUrl(CALENDAR_IMAGES.marketing)} alt="Marketing Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
                <span className="block p-2 font-medium">Marketing Events Calendar</span>
              </Link>
              <Link href="/calendars/real_estate" className="block border-2 border-[var(--color-primary)] rounded-lg overflow-hidden">
                <Image src={cloudinaryFetchUrl(CALENDAR_IMAGES.real_estate)} alt="Real Estate Events" className="w-full aspect-square object-cover" width={640} height={640} sizes="(max-width: 768px) 50vw, 400px" quality={100} />
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
              Northwest Community Sponsors
            </h2>
            <p className="mb-6">
              This community page is all about incentivizing supporting locally owned businesses in Eastern Washington & North Idaho. In fact this company cannot succeed without the support of these businesses, let us as a community support them back. Go check them out, save them as a favorite business, see the events they put on, or purchase items from the Northwest Community Storefront.
            </p>
            <div className="flex gap-3 flex-wrap justify-center md:justify-start">
              <Link href="/support-local" className="btn-sponsors text-sm py-1.5 px-3 md:text-base md:py-2 md:px-4">NWC Sponsors</Link>
              <Link href="/storefront" className="btn-sponsors text-sm py-1.5 px-3 md:text-base md:py-2 md:px-4">NWC Storefront</Link>
              <Link href="/support-nwc" className="btn-sponsors text-sm py-1.5 px-3 md:text-base md:py-2 md:px-4">Support NWC</Link>
            </div>
          </div>
          <div className="flex justify-center">
            <Image
              src={cloudinaryFetchUrl(WIX_IMG("2bdd49_0061748f80f642939a6f4b70ddb4a27d~mv2.jpg/v1/fill/w_1449,h_1482,al_c,q_95,usm_0.66_1.00_0.01,enc_avif,quality_auto/Photo%20Nov%2007%202025%2C%208%2056%2020%20PM_edited_edited.jpg"))}
              alt="Northwest Community"
              className="rounded-lg object-cover"
              width={966}
              height={988}
              sizes="(max-width: 768px) 100vw, 50vw"
              quality={95}
            />
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
          style={{ backgroundImage: `url(${cloudinaryFetchUrl(WIX_IMG(WIX_SUBSCRIBE_BACKGROUND))})` }}
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
              Support what we are doing, but not without benefits! Northwest Community offers coupons to local businesses to incentivize supporting local. We will also do giveaways and prizes for our subscribers. Check out our coupon book, and stay tuned for giveaways, prizes, competitions to win money through NWC, and other benefits by being a subscriber. If you would like your company to become a sponsor or if you&apos;d like to sell through our storefront, check out those benefits below. This site is free and will remain free, but if you feel like tagging along, we appreciate the support!
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/support-nwc" className="btn-sponsors">Subscribe</Link>
              <Link href="/coupons" className="btn-sponsors">Coupons</Link>
              <Link href="/rewards" className="btn-sponsors">Rewards</Link>
              <Link href="/badges" className="btn-sponsors">Community Badges</Link>
            </div>
          </div>
        </div>
      </section>

      <section
        className="grid grid-cols-1 md:grid-cols-2 min-w-0 w-full max-w-none min-h-[500px]"
        style={{ backgroundColor: "#FFF8E1" }}
      >
        <div className="relative min-h-[400px] md:min-h-[500px] order-2 md:order-1">
          <Image
            src={thanksLandscapeUrl ?? "/thanks-landscape.png"}
            alt="Northwest landscape — river and forest"
            className="object-cover"
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            quality={100}
          />
        </div>
        <div className="flex items-center justify-center p-8 md:p-12 order-1 md:order-2" style={{ backgroundColor: "#FFF8E1" }}>
          <div
            className="p-8 md:p-10 max-w-xl w-full md:-ml-16 bg-white border-0"
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
