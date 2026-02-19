import type { Metadata, Viewport } from "next";
import { getServerSession } from "next-auth";
import { Fahkwang } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { authOptions } from "@/lib/auth";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Providers } from "@/components/Providers";
import { ThemeLoader } from "@/components/ThemeLoader";

const fahkwang = Fahkwang({ weight: ["400", "500", "600", "700"], subsets: ["latin"], display: "swap", variable: "--font-fahkwang" });

export const metadata: Metadata = {
  title: "Northwest Community",
  description: "Connecting the good people of Spokane & Kootenai County",
  icons: { icon: "/nwc-logo-circle-crop.png" },
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
  const session = await getServerSession(authOptions);
  return (
    <html lang="en" className={`min-h-full ${fahkwang.variable}`}>
      <body className="min-h-screen flex flex-col" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: "var(--font-body)", color: "var(--color-text)", backgroundColor: "var(--color-background)" }}>
        <Providers session={session}>
          <ThemeLoader />
          <Header />
          <main className="flex-1 flex flex-col min-w-0">{children}</main>
          <Footer />
          <SpeedInsights />
        </Providers>
      </body>
    </html>
  );
}
