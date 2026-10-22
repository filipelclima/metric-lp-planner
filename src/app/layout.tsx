import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Binwise — LP planner for Metric pools",
  description: "Unofficial fee calculator and bin planner for liquidity providers on Metric active pools.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-lg font-semibold tracking-tight">Binwise</span>
            <span className="hidden text-sm text-muted sm:inline">· LP planner for Metric pools</span>
          </Link>
          <a href="https://docs.metric.xyz" target="_blank" rel="noreferrer" className="text-sm text-muted hover:text-text">
            Metric docs ↗
          </a>
        </header>
        <main className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-6 text-xs text-muted sm:flex-row sm:justify-between sm:px-6">
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

function Logo() {
  // Five bars of rising/falling height: a tiny bin histogram.
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="7" fill="#161d2a" />
      {[8, 13, 18, 12, 7].map((h, i) => (
        <rect key={i} x={4 + i * 4} y={21 - h} width="2.6" height={h} rx="1" fill={i === 2 ? "#6ee7c5" : "#a78bfa"} opacity={i === 2 ? 1 : 0.75} />
      ))}
    </svg>
  );
}
