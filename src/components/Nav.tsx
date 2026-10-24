"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { openPalette } from "./CommandPalette";

const LINKS = [
  { href: "/", label: "Planner" },
  { href: "/pools", label: "Top pools" },
  { href: "/portfolio", label: "Portfolio" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-0.5 whitespace-nowrap text-[13px] sm:gap-1 sm:text-sm">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-2 py-1 transition sm:px-2.5 ${active ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
          >
            {l.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={openPalette}
        title="Search pools (Ctrl+K / ⌘K)"
        className="ml-1 flex items-center gap-2 rounded-lg bg-surface-2 px-2 py-1 text-muted transition hover:bg-surface-3 hover:text-text sm:px-2.5"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <span className="sr-only text-xs lg:not-sr-only">Search</span>
        <kbd aria-hidden className="num hidden rounded bg-bg/60 px-1.5 text-xs text-faint lg:inline">
          ⌘K
        </kbd>
      </button>
      <a href="https://docs.metric.xyz" target="_blank" rel="noreferrer" className="hidden px-2.5 py-1 text-muted transition hover:text-text sm:inline">
        Docs ↗
      </a>
    </nav>
  );
}
