import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Shop Local | Northwest Community Storefront",
  description:
    "Browse items from local vendors in Eastern Washington and Northern Idaho. Shop local from the comfort of your home with Northwest Community.",
  openGraph: {
    title: "Shop Local | Northwest Community Storefront",
    description:
      "Browse items from local vendors in Eastern Washington and Northern Idaho. Shop local from the comfort of your home.",
    type: "website",
    images: [
      {
        url: "/storefront-header.png",
        width: 1200,
        height: 630,
        alt: "Northwest Community Storefront",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Shop Local | Northwest Community Storefront",
    description:
      "Browse items from local vendors in Eastern Washington and Northern Idaho.",
    images: ["/storefront-header.png"],
  },
};

export default function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
