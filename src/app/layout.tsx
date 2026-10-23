import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Binwise — LP planner for Metric pools",
  description: "Unofficial fee calculator and bin planner for liquidity providers on Metric active pools.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen antialiased">
        <header className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo size={24} />
            <span className="text-[15px] font-semibold tracking-tight">Binwise</span>
            <span className="hidden text-sm text-faint sm:inline">LP planner for Metric pools</span>
          </Link>
          <Nav />
        </header>
        <main className="mx-auto max-w-[1400px] px-4 pb-24 sm:px-6 lg:pb-10">{children}</main>
        <footer className="border-t border-line/60">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-1 px-4 py-5 text-xs text-faint sm:flex-row sm:justify-between sm:px-6">
            <p>Unofficial community tool, not affiliated with Metric. Not financial advice.</p>
            <p>
              Data: public Metric API ·{" "}
              <a className="underline hover:text-text" href="https://docs.metric.xyz" target="_blank" rel="noreferrer">
                docs.metric.xyz
              </a>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
