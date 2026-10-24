"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fmtUsd } from "@/lib/calc";
import { plannerHref, searchActions, searchPools } from "@/lib/palette";
import { CHAINS, type Pool } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { TokenLogo } from "./ui";

const OPEN_EVENT = "binwise:open-palette";
/** Planner listens for this to switch pools in place (no reload, keeps the rest of the form). */
export const SELECT_POOL_EVENT = "binwise:select-pool";

export const openPalette = () => window.dispatchEvent(new Event(OPEN_EVENT));

type Item = { kind: "pool"; pool: Pool } | { kind: "action"; label: string; href: string };

/** ⌘K / Ctrl+K: search pools by pair, token, chain or address from anywhere; Enter opens it in the planner. */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const path = usePathname();
  const reduced = useReducedMotion();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  // Load the pool list the first time the palette opens (browser-cached after that).
  const [wanted, setWanted] = useState(false);
  const list = useApi<{ pools: Pool[] }>(wanted ? "/api/pools" : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      lastFocus.current = document.activeElement as HTMLElement | null;
      setWanted(true);
      setQuery("");
      setActive(0);
    } else lastFocus.current?.focus?.();
  }, [open]);

  const items: Item[] = useMemo(() => {
    const pools = searchPools(list.data?.pools ?? [], query, query ? 8 : 6).map((pool): Item => ({ kind: "pool", pool }));
    const actions = searchActions(query).map((a): Item => ({ kind: "action", label: a.label, href: a.href }));
    return query ? [...pools, ...actions] : [...actions, ...pools];
  }, [list.data, query]);

  const choose = (it: Item | undefined) => {
    if (!it) return;
    setOpen(false);
    if (it.kind === "action") return router.push(it.href);
    if (path === "/") window.dispatchEvent(new CustomEvent(SELECT_POOL_EVENT, { detail: it.pool }));
    else router.push(plannerHref(it.pool));
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Search pools and actions"
            className="w-full max-w-xl overflow-hidden rounded-2xl bg-surface-2 shadow-2xl shadow-black/70 ring-1 ring-white/5"
            initial={reduced ? false : { y: -8, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={reduced ? undefined : { y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
          >
            <input
              ref={inputRef}
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
              aria-label="Search pools by pair, token, chain or address"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((a) => Math.min(items.length - 1, a + 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((a) => Math.max(0, a - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  choose(items[active]);
                } else if (e.key === "Escape") setOpen(false);
              }}
              placeholder="Search pools (pair, token, chain, 0x…) or jump to a page"
              className="w-full bg-transparent px-5 py-4 text-base text-text outline-none placeholder:text-faint"
            />
            <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto border-t border-white/5 p-2">
              {list.loading && !list.data && <li className="px-3 py-2 text-sm text-muted">Loading pools…</li>}
              {items.length === 0 && !list.loading && <li className="px-3 py-2 text-sm text-muted">No matches.</li>}
              {items.map((it, i) => (
                <li
                  key={it.kind === "pool" ? `${it.pool.chainId}:${it.pool.poolAddress}` : it.href}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(it)}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${i === active ? "bg-surface-3 text-text" : "text-muted"}`}
                >
                  {it.kind === "pool" ? (
                    <>
                      <span className="flex -space-x-1.5">
                        <TokenLogo src={it.pool.token0.logoUrl} symbol={it.pool.token0.symbol} />
                        <TokenLogo src={it.pool.token1.logoUrl} symbol={it.pool.token1.symbol} />
                      </span>
                      <span className="font-medium text-text">{it.pool.pair}</span>
                      <span className="text-xs text-faint">{CHAINS[it.pool.chainId]?.short}</span>
                      <span className="num ml-auto text-xs text-muted">TVL {fmtUsd(it.pool.tvlFiat, { compact: true }).replace(".00", "")}</span>
                    </>
                  ) : (
                    <>
                      <span aria-hidden className="flex h-5 w-5 items-center justify-center rounded bg-surface-3 text-xs text-accent">
                        →
                      </span>
                      <span>{it.label}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-white/5 px-4 py-2 text-xs text-faint">
              <span>↑↓ to move · Enter to open · Esc to close</span>
              <span className="num">⌘K</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
