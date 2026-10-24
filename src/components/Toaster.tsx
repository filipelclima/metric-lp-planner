"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

type Tone = "success" | "error" | "info";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const EVENT = "binwise:toast";
let nextId = 1;

/** Shows a toast from anywhere ("Plan copied ✓", "Link copied ✓", errors). */
export function toast(message: string, tone: Tone = "success") {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<Toast>(EVENT, { detail: { id: nextId++, message, tone } }));
}

const STYLE: Record<Tone, string> = {
  success: "text-text [&_.dot]:bg-good",
  error: "text-text [&_.dot]:bg-bad",
  info: "text-text [&_.dot]:bg-accent",
};

/** Bottom-right stack (above the mobile Edit bar); polite live region for screen readers. */
export default function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  const reduced = useReducedMotion();
  useEffect(() => {
    const add = (e: Event) => {
      const t = (e as CustomEvent<Toast>).detail;
      setItems((list) => [...list.slice(-2), t]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== t.id)), t.tone === "error" ? 5000 : 2400);
    };
    window.addEventListener(EVENT, add);
    return () => window.removeEventListener(EVENT, add);
  }, []);
  return (
    <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col items-end gap-2 lg:bottom-6 lg:right-6">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-xl bg-surface-3 px-4 py-2.5 text-sm shadow-2xl shadow-black/50 ring-1 ring-white/5 ${STYLE[t.tone]}`}
          >
            <span className="dot h-2 w-2 shrink-0 rounded-full" aria-hidden />
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
