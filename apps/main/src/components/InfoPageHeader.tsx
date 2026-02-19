import Link from "next/link";
import Image from "next/image";

const HEADER_BG = "rgba(62, 67, 47, 0.9)"; // dark olive at 90% opacity

export interface InfoPageHeaderProps {
  title: string;
  description: string;
  policyHref: string;
  policyLabel: string;
  /** Override logo URL (from admin Site Images). */
  logoUrl?: string | null;
  /** Optional Terms of Service and Privacy Policy links (e.g. for sponsor-nwc). */
  termsHref?: string;
  privacyHref?: string;
}

export function InfoPageHeader({ title, description, policyHref, policyLabel, logoUrl, termsHref, privacyHref }: InfoPageHeaderProps) {
  return (
    <>
      {/* Plan: more space walls–header/paragraph; header font -30% on mobile */}
      <header
        className="pt-6 pb-20 px-6 md:pt-8 md:pb-24 lg:pt-10 lg:pb-28 md:px-4"
        style={{
          paddingLeft: "2rem",
          paddingRight: "2rem",
          backgroundColor: HEADER_BG,
          color: "#fff",
        }}
      >
        <div className="max-w-[var(--max-width)] mx-auto flex flex-col items-center text-center">
          <h1 className="text-[2.1rem] md:text-5xl lg:text-6xl font-bold mb-8 text-white" style={{ fontFamily: "var(--font-heading)", color: "#fff" }}>
            {title}
          </h1>
          <div className="w-36 h-36 md:w-44 md:h-44 lg:w-52 lg:h-52 rounded-full overflow-hidden shrink-0 mb-6 flex items-center justify-center bg-white/10">
            <Image
              src={logoUrl ?? "/nwc-logo-circle.png"}
              alt="Northwest Community"
              width={208}
              height={208}
              className="w-full h-full object-cover"
              quality={100}
            />
          </div>
          <p className="text-white/95 text-base md:text-lg lg:text-xl leading-relaxed mb-6 max-w-2xl">
            {description}
          </p>
          <hr className="border-white/40 w-full max-w-md mb-6" />
          <div className="flex flex-wrap gap-3 justify-center items-center">
            <Link href={policyHref} className="btn">
              {policyLabel}
            </Link>
            {termsHref && (
              <Link href={termsHref} className="btn" style={{ backgroundColor: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.5)" }}>
                Terms of Service
              </Link>
            )}
            {privacyHref && (
              <Link href={privacyHref} className="btn" style={{ backgroundColor: "rgba(255,255,255,0.2)", border: "1px solid rgba(255,255,255,0.5)" }}>
                Privacy Policy
              </Link>
            )}
          </div>
        </div>
      </header>
      <div style={{ height: "1px", backgroundColor: "rgba(255,255,255,0.5)", width: "100%" }} aria-hidden />
    </>
  );
}
