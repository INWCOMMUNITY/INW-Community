import Link from "next/link";
import Image from "next/image";
import { GoalSection } from "@/components/GoalSection";
import { cloudinaryFetchUrl } from "@/lib/cloudinary";
import { WIX_IMG } from "@/lib/wix-media";
import { getSiteImageUrl } from "@/lib/site-images";

const ABOUT_PAGE_TAN = "#F5E9CE";

export default async function AboutPage() {
  const [logoUrl, goals1Url, goals2Url, goals3Url, foundationUrl] = await Promise.all([
    getSiteImageUrl("nwc-logo-circle"),
    getSiteImageUrl("goals-1"),
    getSiteImageUrl("goals-2"),
    getSiteImageUrl("goals-3"),
    getSiteImageUrl("foundation-background"),
  ]);
  return (
    <div style={{ backgroundColor: ABOUT_PAGE_TAN, minHeight: "100%" }}>
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)", backgroundColor: "white" }}>
        <div className="max-w-[var(--max-width)] mx-auto flex flex-col items-center text-center">
          <Image
            src={logoUrl ?? cloudinaryFetchUrl("/nwc-logo-circle.png")}
            alt="Northwest Community"
            width={200}
            height={200}
            className="mb-6 rounded-full object-cover"
            priority
            quality={100}
          />
          <h1 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: "var(--color-heading)" }}>
            About Northwest Community
          </h1>
          <p className="mb-6 opacity-90 max-w-2xl text-base md:text-lg" style={{ color: "var(--color-primary)" }}>
            As a startup, we do not currently have all the resources we need to do what we want. We would love to share our goals for the future, and where we would like to see our business in a few years!
          </p>
        </div>
      </section>

      <GoalSection
        number={1}
        title="Create a community page that benefits local businesses, people, and our local economy."
        imageSrc={goals1Url ?? cloudinaryFetchUrl("/goals-1.png")}
        imageAlt="Marina and local community"
        sectionBackground={ABOUT_PAGE_TAN}
      >
        <p className="mb-4">
          The goal of this website is to create a hub where local people can connect over hobbies, business, events, and more. This website is exclusive to residents of the area. Let us create a community that supports its neighbors and the people in our area.
        </p>
        <p className="mb-4">
          Let&apos;s spend our money in the pockets of those close to us. Let&apos;s invest in the people 50 miles away, and not 5000 miles away. Northwest Communities&apos; mission is to make this as easy as possible.
        </p>
        <p>
          The success of this site depends on the support of local people, and the businesses that want to remind the community that they are here, that they care, and that they are accessible.
        </p>
      </GoalSection>

      <GoalSection
        number={2}
        title="Host events that support the people in the surrounding cities."
        imageSrc={goals2Url ?? cloudinaryFetchUrl("/goals-2.png")}
        imageAlt="Community and local area"
        sectionBackground={ABOUT_PAGE_TAN}
      >
        <p className="mb-4">
          The more this business grows, the more we will be able to give back to the community. We will put on events that are fun and unite people in this area. We will host scavenger hunts with prize giveaways, easter egg hunts, competitions, fundraisers, and lots more.
        </p>
        <p className="mb-4">
          The more support we get, the bigger these events, prizes, and giveaways can be. Our goal in a few years is to have consistent prizes given to the people who are most actively supporting local businesses.
        </p>
      </GoalSection>

      <GoalSection
        number={3}
        title="Create a successful local online shopping platform that makes supporting local businesses that much easier."
        imageSrc={goals3Url ?? cloudinaryFetchUrl("/goals-3.png")}
        imageAlt="Northwest community"
        sectionBackground={ABOUT_PAGE_TAN}
      >
        <p className="mb-4">
          We already have an online shopping platform, but we would love to see this aspect of our website blossom over the years. It is so convenient to shop online, but unfortunately, it can hurt business for local companies.
        </p>
        <p className="mb-4">
          One of our goals is to make shopping local as easy as possible. No longer will shopping online take away from shopping local in this community. Over the years, Northwest Community hopes to have many options for items that can be purchased easily and locally.
        </p>
      </GoalSection>

      {/* Northwest Communities Foundation – marina/beach background */}
      <section className="relative w-full min-h-[320px] flex items-center justify-center overflow-hidden">
        <img
          src={foundationUrl ?? cloudinaryFetchUrl("/foundation-background.png")}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="relative z-10 max-w-2xl mx-auto px-6 py-12 text-center">
          <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-8 md:p-10">
            <h2 className="text-xl md:text-2xl font-bold mb-4" style={{ color: "var(--color-heading)" }}>
              Northwest Communities Foundation
            </h2>
            <p className="text-gray-700 leading-relaxed">
              These are the principles Northwest Community will use to build its system. Putting people before business, and aiming for a united community full of honest people. If these principles are not set in place as a company, we will have failed to bring all that we can to this community. We are dedicated to building something valuable here.
            </p>
          </div>
        </div>
      </section>

      <div style={{ backgroundColor: "white" }}>
      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <img
                src={cloudinaryFetchUrl(WIX_IMG("2bdd49_5e66f29694cd4b91a23e5a3e0ee2e0b7~mv2.jpg/v1/fill/w_421,h_250,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Principles%203.jpg"))}
                alt="Supporting Local People"
                width={421}
                height={250}
                className="rounded-lg w-full h-auto object-cover mb-4"
              />
              <h3 className="text-base font-semibold mb-2" style={{ color: "var(--color-heading)" }}>Supporting Local People</h3>
              <p className="text-gray-700">A community is built with gratitude, kindness, help, and support. The people who support local businesses, deserve to be supported by local businesses. We will prioritize people over business.</p>
            </div>
            <div>
              <img
                src={cloudinaryFetchUrl(WIX_IMG("2bdd49_ebdd31ab774b493a9c0db7a420d45870~mv2.jpg/v1/fill/w_421,h_250,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/1.jpg"))}
                alt="Helping the Community"
                width={421}
                height={250}
                className="rounded-lg w-full h-auto object-cover mb-4"
              />
              <h3 className="text-base font-semibold mb-2" style={{ color: "var(--color-heading)" }}>Helping the Community</h3>
              <p className="text-gray-700">There are lots of outlets to help support this area. Northwest Community hopes to plan, support, and volunteer for events that give back to the community, sponsored by the local businesses that make this area great.</p>
            </div>
            <div>
              <img
                src={cloudinaryFetchUrl(WIX_IMG("2bdd49_83882a11455141ffbbb316c8d27fde32~mv2.jpg/v1/fill/w_421,h_250,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/0035_33_edited.jpg"))}
                alt="Sharing Local Art & Artists"
                width={421}
                height={250}
                className="rounded-lg w-full h-auto object-cover mb-4"
              />
              <h3 className="text-base font-semibold mb-2" style={{ color: "var(--color-heading)" }}>Sharing Local Art &amp; Artists</h3>
              <p className="text-gray-700">Northwest Community is more than just a site for local businesses. It&apos;s a place where local people can connect and share their work as they create music, practice hobbies, make art, etc. Talent is endless in the PNW.</p>
            </div>
            <div>
              <img
                src={cloudinaryFetchUrl(WIX_IMG("2bdd49_2d6af4dc1cf445c6b1befdcb25b3c7cd~mv2.jpg/v1/fill/w_421,h_250,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/Principle%203.jpg"))}
                alt="Supporting Local Business"
                width={421}
                height={250}
                className="rounded-lg w-full h-auto object-cover mb-4"
              />
              <h3 className="text-base font-semibold mb-2" style={{ color: "var(--color-heading)" }}>Supporting Local Business</h3>
              <p className="text-gray-700">Local businesses are a foundational point in our community. Northwest Community&apos;s main objective is to ensure that locally owned businesses here in the Spokane / Kootenai County area continue to thrive.</p>
            </div>
            <div>
              <img
                src={cloudinaryFetchUrl(WIX_IMG("2bdd49_46bd85d79e654db9bfc8b6d2a206d9a2~mv2.jpg/v1/fill/w_421,h_250,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/0005_3A.jpg"))}
                alt="Incentivize Supporting Local"
                width={421}
                height={250}
                className="rounded-lg w-full h-auto object-cover mb-4"
              />
              <h3 className="text-base font-semibold mb-2" style={{ color: "var(--color-heading)" }}>Incentivize Supporting Local</h3>
              <p className="text-gray-700">Northwest Community will put together programs, competitions, prizes, and events that incentivize our community to support local businesses. Paid for by our business sponsors at no extra expense. Businesses give back.</p>
            </div>
            <div>
              <img
                src={cloudinaryFetchUrl(WIX_IMG("2bdd49_9e6b238548344f30bffd2795c2bfc194~mv2.jpg/v1/fill/w_421,h_250,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/0036_34.jpg"))}
                alt="Honest Business Practice"
                width={421}
                height={250}
                className="rounded-lg w-full h-auto object-cover mb-4"
              />
              <h3 className="text-base font-semibold mb-2" style={{ color: "var(--color-heading)" }}>Honest Business Practice</h3>
              <p className="text-gray-700">This business will show integrity in the work we perform. This business will always be real people from here in town. Small businesses should have an approachable feel. Unethical business practices is not welcome on our site.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="py-12 px-4" style={{ padding: "var(--section-padding)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <Link href="/support-nwc" className="btn">Support NWC</Link>
          <Link href="/" className="btn ml-4">Back to home</Link>
        </div>
      </section>
      </div>
    </div>
  );
}

