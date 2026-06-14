import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "FlipRadar",
  description: "Resale arbitrage deal finder",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white px-4 py-3">
          <nav className="mx-auto flex max-w-5xl items-center gap-6">
            <span className="font-semibold tracking-tight">FlipRadar</span>
            <a href="/" className="text-sm text-zinc-600 hover:text-zinc-900">Deals</a>
            <a href="/garage-sales" className="text-sm text-zinc-600 hover:text-zinc-900">Garage Sales</a>
            <a href="/tracking" className="text-sm text-zinc-600 hover:text-zinc-900">Tracking</a>
            <a href="/route" className="text-sm text-zinc-600 hover:text-zinc-900">Route</a>
            <a href="/settings" className="ml-auto text-sm text-zinc-600 hover:text-zinc-900">Settings</a>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
