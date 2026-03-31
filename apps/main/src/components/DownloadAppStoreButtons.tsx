"use client";

import { IonIcon } from "@/components/IonIcon";

const storeButtonClass =
  "btn !flex flex-col w-full max-w-md min-h-[4.25rem] py-3 px-3 items-center justify-center gap-2 text-center text-base";

const androidComingSoonClass =
  "!flex flex-col w-full max-w-md min-h-[4.25rem] py-3 px-3 items-center justify-center gap-2 text-center text-base border-2 border-gray-300 bg-gray-100 text-gray-600 cursor-not-allowed font-medium opacity-90";

export function DownloadAppStoreButtons({
  iosUrl,
  androidUrl,
  /** `home`: two columns from md breakpoint; `default`: always stacked */
  variant = "default",
}: {
  iosUrl: string;
  androidUrl?: string;
  variant?: "default" | "home";
}) {
  const listClassName =
    variant === "home"
      ? "grid grid-cols-1 md:grid-cols-2 md:items-stretch gap-4 md:gap-5 w-full md:max-w-3xl md:mx-auto list-none p-0 m-0"
      : "flex flex-col gap-4 sm:gap-5 w-full list-none p-0 m-0";

  const stretchHome = variant === "home" ? "md:h-full md:flex md:flex-col" : "";
  const fillHome = variant === "home" ? "md:h-full md:min-h-0" : "";

  return (
    <ul className={listClassName}>
      <li className={stretchHome}>
        <a
          href={iosUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${storeButtonClass} ${fillHome}`}
        >
          <span className="flex w-full justify-center shrink-0">
            <IonIcon name="logo-apple-appstore" size={30} />
          </span>
          <span className="block w-full text-center leading-snug">Download on the App Store</span>
        </a>
      </li>
      <li className={stretchHome}>
        {androidUrl ? (
          <a
            href={androidUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${storeButtonClass} ${fillHome}`}
          >
            <span className="flex w-full justify-center shrink-0">
              <IonIcon name="logo-google-playstore" size={28} />
            </span>
            <span className="block w-full text-center leading-snug">Get it on Google Play</span>
          </a>
        ) : (
          <button
            type="button"
            disabled
            className={`${androidComingSoonClass} ${fillHome}`}
            style={{
              fontFamily: "var(--font-heading)",
              borderRadius: "var(--button-border-radius)",
            }}
          >
            <span className="flex w-full justify-center shrink-0">
              <IonIcon name="logo-google-playstore" size={28} className="opacity-80" />
            </span>
            <span className="block w-full text-center leading-snug">Google Play (coming soon)</span>
          </button>
        )}
      </li>
    </ul>
  );
}
