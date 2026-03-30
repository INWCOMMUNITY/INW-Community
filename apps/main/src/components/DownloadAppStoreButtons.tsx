"use client";

import { IonIcon } from "@/components/IonIcon";

const storeButtonClass =
  "btn inline-flex flex-col w-full max-w-md min-h-[4.25rem] py-3 px-3 items-center justify-center gap-2 text-center text-base";

const androidComingSoonClass =
  "inline-flex flex-col w-full max-w-md min-h-[4.25rem] py-3 px-3 items-center justify-center gap-2 text-center text-base border-2 border-gray-300 bg-gray-100 text-gray-600 cursor-not-allowed font-medium opacity-90";

export function DownloadAppStoreButtons({
  iosUrl,
  androidUrl,
}: {
  iosUrl: string;
  androidUrl?: string;
}) {
  return (
    <ul className="flex flex-col gap-4 sm:gap-5 w-full list-none p-0 m-0">
      <li>
        <a
          href={iosUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={storeButtonClass}
        >
          <span className="flex w-full justify-center shrink-0">
            <IonIcon name="logo-apple-appstore" size={30} />
          </span>
          <span className="block w-full text-center leading-snug">Download on the App Store</span>
        </a>
      </li>
      <li>
        {androidUrl ? (
          <a
            href={androidUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={storeButtonClass}
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
            className={androidComingSoonClass}
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
