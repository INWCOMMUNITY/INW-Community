import Link from "next/link";
import Image from "next/image";
import { WIX_IMG, WIX_SUBSCRIBE_BACKGROUND, CALENDAR_IMAGES } from "@/lib/wix-media";
import { getSiteImageUrl } from "@/lib/site-images";
import { DownloadAppStoreButtons } from "@/components/DownloadAppStoreButtons";
import { IonIcon } from "@/components/IonIcon";
import { getAndroidPlayStoreUrl, getIosAppStoreUrl } from "@/lib/app-store-urls";

const EXPLORE_CARDS = [
  { href: "/storefront", title: "Shop", description: "Browse goods from local sellers.", icon: "bag-outline" },
  { href: "/calendars", title: "Events", description: "See what is happening around the Inland Northwest.", icon: "calendar-outline" },
  { href: "/my-community/feed", title: "Community Feed", description: "Posts, groups, and neighbors nearby.", icon: "people-outline" },
  { href: "/support-local", title: "Local Businesses", description: "Find shops and services in your area.", icon: "storefront-outline" },
] as const;

const CALENDARS = [
  { href: "/calendars/fun_events", image: CALENDAR_IMAGES.fun_events, alt: "Fun Events", label: "Fun Events" },
  { href: "/calendars/local_art_music", image: CALENDAR_IMAGES.local_art_music, alt: "Local Art & Music", label: "Art & Music" },
  { href: "/calendars/non_profit", image: CALENDAR_IMAGES.non_profit, alt: "Non-Profit Events", label: "Non-Profit" },
  { href: "/calendars/business_promotional", image: CALENDAR_IMAGES.business_promotional, alt: "Community Events", label: "Community" },
  { href: "/calendars/marketing", image: CALENDAR_IMAGES.marketing, alt: "Marketing Events", label: "Marketing" },
  { href: "/calendars/real_estate", image: CALENDAR_IMAGES.real_estate, alt: "Real Estate Events", label: "Real Estate" },
] as const;

export default async function HomePage() {
  const founderThanksUrl = (await getSiteImageUrl("founder-thanks")) ?? "/founder-thanks.png?v=4";
  const heroBackgroundUrl = (await getSiteImageUrl("hero-background")) ?? "/hero-background.png";
  const appLogoUrl = (await getSiteImageUrl("nwc-logo-circle")) ?? "/nwc-logo-circle.png";
  const communityGoalsUrl = (await getSiteImageUrl("community-goals")) ?? "/community-goals.png";
  const iosAppStoreUrl = getIosAppStoreUrl();
  const androidPlayStoreUrl = getAndroidPlayStoreUrl();
  return (
    <>
      <section className="relative flex flex-col overflow-hidden bg-[#F5E9D3] md:min-h-[calc(85vh-12rem)] md:bg-transparent">
        <div
          className="absolute inset-0 hidden bg-cover bg-center md:block"
          style={{ backgroundImage: `url(${heroBackgroundUrl})` }}
          aria-hidden
        />
        <div
          className="absolute inset-0 hidden md:block bg-gradient-to-t from-black/70 via-black/20 to-transparent"
          aria-hidden
        />
        <div className="relative z-10 flex flex-1 flex-col items-center w-full max-w-[var(--max-width)] mx-auto px-4 py-12 md:min-h-[calc(85vh-12rem)] md:pt-24 md:pb-20">
          <div className="h-48 w-48 md:h-72 md:w-72 lg:h-80 lg:w-80 overflow-hidden rounded-full shrink-0 md:mt-6">
            <Image
              src={appLogoUrl}
              alt="Northwest Community"
              width={320}
              height={320}
              className="h-full w-full object-cover"
              sizes="(min-width: 1024px) 320px, (min-width: 768px) 288px, 192px"
              priority
            />
          </div>
          <div className="mt-auto text-center max-w-2xl pt-8 md:mb-6">
            <h1
              className="text-3xl md:text-5xl font-bold mb-3 text-[var(--color-heading)] md:!text-white"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Support Local in the Inland Northwest.
            </h1>
            <p className="text-base md:text-lg mb-6 leading-relaxed mx-auto text-[var(--color-text)] md:!text-white/95">
              Invest into our community, and the future of it. Purchase local goods online, join the community feed, find local events, and more. Be a part of what&apos;s happening!
            </p>
            <div className="grid grid-cols-2 gap-3 w-full max-w-sm mx-auto">
              <Link href="/signup" className="btn inline-flex items-center justify-center text-center w-full">
                Join Now
              </Link>
              <Link
                href="#explore"
                className="btn inline-flex items-center justify-center text-center w-full !bg-[var(--color-earth)] !text-white hover:!bg-[var(--color-button-hover)] hover:!text-[var(--color-button-hover-text)]"
              >
                Explore
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="explore" className="w-full py-12 px-6 md:px-8 bg-white scroll-mt-24">
        <div className="max-w-[var(--max-width)] mx-auto">
          <h2
            className="text-2xl md:text-3xl font-bold mb-8 text-center"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            What you can do here
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {EXPLORE_CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="rounded-lg px-5 py-6 text-left transition-colors hover:bg-[var(--color-section-alt)] border border-[var(--color-earth)] hover:border-[var(--color-earth)]"
              >
                <span
                  className="inline-flex items-center justify-center w-11 h-11 rounded-full mb-4 border border-[var(--color-primary)]/20 bg-white"
                  style={{ color: "var(--color-primary)" }}
                >
                  <IonIcon name={card.icon} size={24} />
                </span>
                <h3 className="text-lg font-semibold mb-2" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
                  {card.title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: "var(--color-text)" }}>
                  {card.description}
                </p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="w-full py-12 px-6 md:px-8" style={{ backgroundColor: "var(--color-section-alt)" }}>
        <div className="max-w-[var(--max-width)] mx-auto text-center">
          <h2
            className="text-2xl md:text-3xl font-bold mb-8"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}
          >
            Calendars
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {CALENDARS.map((cal) => (
              <Link
                key={cal.href}
                href={cal.href}
                className="block rounded-lg overflow-hidden border border-[var(--color-primary)]/30 hover:border-[var(--color-primary)] transition-colors bg-white"
              >
                <Image
                  src={cal.image}
                  alt={cal.alt}
                  className="w-full aspect-square object-cover"
                  width={640}
                  height={640}
                  sizes="(max-width: 768px) 50vw, 400px"
                  quality={100}
                />
                <span className="block p-2 font-medium">{cal.label}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="w-full py-12 px-6 md:px-8 bg-white">
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
            Get reward points, join groups, see event calendars, access coupons, and shop local goods from your phone.
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

      <section className="w-full py-12 px-6 md:px-8" style={{ backgroundColor: "var(--color-primary)", color: "#fff" }}>
        <div className="max-w-[var(--max-width)] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-10 items-start">
          <div className="text-center md:text-left min-w-0">
            <h2
              className="text-2xl md:text-3xl font-bold mb-3 !text-white"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Our Goal
            </h2>
            <p className="mb-6 leading-relaxed text-white/95">
              We encourage the residents of the Inland Northwest to choose local businesses over corporate companies. Supporting local supports the dreams and independence of our neighbors, and boosts our own local economy without sending millions of dollars out of state. Northwest Community aims to make supporting local sellers, businesses, and artisans as convenient as possible.
            </p>
            <div className="flex gap-3 flex-wrap justify-center md:justify-start">
              <Link
                href="/support-local"
                className="btn inline-block whitespace-nowrap !bg-white !text-[var(--color-primary)]"
              >
                Support Local
              </Link>
              <Link href="/about" className="btn-outline inline-block whitespace-nowrap !border-white !text-white hover:!bg-white/15 hover:!text-white">
                About NWC
              </Link>
              <Link href="/storefront" className="btn-outline inline-block whitespace-nowrap !border-white !text-white hover:!bg-white/15 hover:!text-white">
                NWC Storefront
              </Link>
            </div>
            <p className="mt-4">
              <Link href="/business-hub" className="underline-offset-2 hover:underline text-white/90">
                Own a local business? Join the directory
              </Link>
            </p>
          </div>
          <div className="flex justify-center md:justify-end w-full min-w-0">
            <Image
              src={communityGoalsUrl}
              alt="Northwest Community"
              className="rounded-lg object-cover object-bottom w-full max-w-[420px] aspect-square"
              width={420}
              height={420}
              sizes="(max-width: 768px) 100vw, 420px"
              quality={95}
            />
          </div>
        </div>
      </section>

      <div className="h-[3px] bg-white" aria-hidden />

      <section className="relative w-full py-16 px-6 md:px-8 overflow-hidden flex flex-col justify-center">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${WIX_IMG(WIX_SUBSCRIBE_BACKGROUND)})` }}
          aria-hidden
        />
        <div className="relative z-10 max-w-2xl mx-auto w-full">
          <div
            className="rounded-lg p-8 md:p-10 text-center"
            style={{ backgroundColor: "rgba(253, 237, 204, 0.85)" }}
          >
            <h2 className="text-xl md:text-2xl font-bold mb-4 leading-tight" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
              Subscribe to Northwest Community
            </h2>
            <p className="mb-8 leading-relaxed" style={{ color: "var(--color-heading)" }}>
              The site stays free. Subscribers get local coupons, giveaways, and other benefits that support shopping local. If you want to tag along, we appreciate it.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link href="/support-nwc" className="btn whitespace-nowrap">Subscribe</Link>
              <Link href="/coupons" className="btn-outline whitespace-nowrap">Coupons</Link>
            </div>
          </div>
        </div>
      </section>

      <div className="h-[3px] bg-white" aria-hidden />

      <section className="w-full py-12 px-6 md:px-8" style={{ backgroundColor: "var(--color-section-alt)" }}>
        <div className="max-w-[var(--max-width)] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="relative w-full max-w-xl mx-auto aspect-[4/3] min-h-[280px] overflow-hidden rounded-lg order-2 md:order-1">
            <Image
              src={founderThanksUrl}
              alt="Northwest Community — pet area and local community"
              fill
              className="object-cover object-center"
              sizes="(max-width: 768px) 100vw, 576px"
              quality={100}
            />
          </div>
          <div className="order-1 md:order-2 text-center md:text-left">
            <h2 className="text-2xl md:text-3xl font-bold mb-4" style={{ fontFamily: "var(--font-heading)", color: "var(--color-heading)" }}>
              Hey! Thank you for being here!
            </h2>
            <p className="mb-4 leading-relaxed" style={{ color: "var(--color-text)" }}>
              We are a startup established in 2025. I grew up in a locally owned business, supported by this community, and I want to see local businesses and local people succeed here. Coeur d&apos;Alene is my home. Just by you being here, we are a step closer to making this a valuable resource for the Inland Northwest. Stay in touch, and watch us grow. Welcome to Northwest Community.
            </p>
            <p className="font-medium" style={{ color: "var(--color-text)" }}>- Donivan Floyd</p>
          </div>
        </div>
      </section>
    </>
  );
}
