import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { CurrencyProvider } from "@/components/providers/currency-provider";
import { ShortcutsProvider } from "@/components/providers/shortcuts-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SOTP Lead Engine · Tbilisi Lead CRM",
  description:
    "Clean, calm CRM for Tbilisi real-estate leads — ss.ge + Facebook listings deduped by the SOTP pipeline.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <CurrencyProvider>
          <ShortcutsProvider>{children}</ShortcutsProvider>
        </CurrencyProvider>
      </body>
    </html>
  );
}
