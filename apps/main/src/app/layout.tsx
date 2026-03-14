import type { Metadata, Viewport } from "next";
import { Fahkwang } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { getServerSession } from "@/lib/auth";
import { ConditionalHeader } from "@/components/ConditionalSiteChrome";
import { ConditionalFooter } from "@/components/ConditionalSiteChrome";
import { Providers } from "@/components/Providers";
import { ThemeLoader } from "@/components/ThemeLoader";

const fahkwang = Fahkwang({ weight: ["400", "500", "600", "700"], subsets: ["latin"], display: "swap", variable: "--font-fahkwang" });

const baseUrl = process.env.NEXTAUTH_URL ?? "https://inwcommunity.com";

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: "Northwest Community",
  description: "Connecting the good people of Spokane & Kootenai County",
  icons: { icon: "/nwc-logo-circle.png" },
  openGraph: {
    title: "Northwest Community",
    description: "Connecting the good people of Spokane & Kootenai County",
    images: [{ url: "/nwc-logo-circle.png", width: 512, height: 512, alt: "Northwest Community" }],
  },
  twitter: {
    card: "summary",
    title: "Northwest Community",
    description: "Connecting the good people of Spokane & Kootenai County",
    images: ["/nwc-logo-circle.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  return (
    <html lang="en" className={`min-h-full ${fahkwang.variable}`}>
      <body className="min-h-screen flex flex-col" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "var(--font-body)", color: "var(--color-text)", backgroundColor: "var(--color-background)" }}>
        <Providers session={session}>
          <ThemeLoader />
          <ConditionalHeader />
          <main className="flex-1 flex flex-col min-w-0">{children}</main>
          <ConditionalFooter />
          <SpeedInsights />
        </Providers>
      </body>
    </html>
  );
}
