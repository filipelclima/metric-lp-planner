"use client";
import { useState } from "react";
import { PICKER_STORAGE_KEY, readPickerPrefs, serializePrefs, type PickerPrefs } from "./poolList";

function loadStored(): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(PICKER_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Pool picker sort/filter/period: from the URL, else localStorage, else defaults; changes are saved to localStorage. */
export function usePickerPrefs(params: URLSearchParams) {
  const [prefs, setState] = useState<PickerPrefs>(() => readPickerPrefs(params, loadStored()));
  const setPrefs = (p: PickerPrefs) => {
    setState(p);
    try {
      window.localStorage.setItem(PICKER_STORAGE_KEY, serializePrefs(p));
    } catch {
      /* storage unavailable (private mode, blocked): URL still carries the prefs */
    }
  };
  return [prefs, setPrefs] as const;
}

export type PickerPrefsState = ReturnType<typeof usePickerPrefs>;
