import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NWC Admin",
  description: "Northwest Community Admin",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen" style={{ backgroundColor: "#f5f5f4", color: "#505542" }}>{children}</body>
    </html>
  );
}
