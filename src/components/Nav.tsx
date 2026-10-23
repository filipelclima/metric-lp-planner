"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
      <a href="https://docs.metric.xyz" target="_blank" rel="noreferrer" className="hidden px-2.5 py-1 text-muted transition hover:text-text sm:inline">
        Docs ↗
      </a>
    </nav>
  );
}
