import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import Image from "next/image";
import MobileNav from "./components/MobileNav";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Filter Compiler - BlockAds",
  icons: {
    icon: "/favicon.svg",
    apple: "/favicon.svg",
  },
  description:
    "Compile BlockAds filter lists into optimized `.trie`, `.bloom`, and `.css` binary formats.",
  metadataBase: new URL("https://blockads.pwhs.app/"),
  keywords: [
    "ad blocker",
    "block ads",
    "android",
    "dns filter",
    "privacy",
    "free",
    "open source",
  ],
  authors: [{ name: "pass-with-high-score" }],
  creator: "pass-with-high-score",
  publisher: "BlockAds",
  robots: "index, follow",
};

function Navbar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/80 border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 group">
          <Image src="/icon.svg" alt="BlockAds" width={32} height={32} className="rounded-lg" />
          <span className="font-semibold text-lg">
            Block<span className="text-[#00E676]">Ads</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6 text-sm text-gray-600">
          <a href="mailto:nguyenquangminh570@gmail.com" className="hover:text-gray-900 transition-colors">
            Contact
          </a>
          <a href="https://t.me/blockads_android" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition-colors">
            Telegram
          </a>
          <a href="https://www.reddit.com/r/BlockAds/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition-colors">
            Reddit
          </a>
        </div>

        {/* Mobile nav */}
        <MobileNav />
      </div>
    </nav>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-200 py-12 mt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Image src="/icon.svg" alt="BlockAds" width={28} height={28} className="rounded-lg" />
              <span className="font-semibold">
                Block<span className="text-[#00E676]">Ads</span>
              </span>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              Free, open-source ad blocker for Android.
              <br />
              No root. No data collection. No ads.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Links & Community</h4>
            <div className="flex flex-col gap-2 text-sm text-gray-600">
              <a href="mailto:nguyenquangminh570@gmail.com" className="hover:text-gray-900 transition-colors">
                Email / Contact
              </a>
              <a href="https://t.me/blockads_android" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition-colors">
                Telegram
              </a>
              <a href="https://www.reddit.com/r/BlockAds/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition-colors">
                Reddit
              </a>
            </div>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-gray-200 text-center text-xs text-gray-600">
          © {new Date().getFullYear()} BlockAds. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <Navbar />
        <main className="pt-16">{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
