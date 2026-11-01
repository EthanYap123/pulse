"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  THEME_STORAGE_KEY,
  parsePreference,
  resolveTheme,
  type ThemePreference,
} from "@/lib/theme";

const CHANGE_EVENT = "pulse-theme-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "light";
  }
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange); // another tab changed it
  media.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onChange);
  };
}

/** "light" | "dark" | "system" plus whether the device is dark, as one comparable string. */
function snapshot(): string {
  return `${readPreference()}:${window.matchMedia(DARK_QUERY).matches ? "dark" : "light"}`;
}

function choose(next: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private browsing: the choice just isn't remembered after reload.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Sun/moon toggle plus a Light / Dark / Match device setting. Light is the default. */
export function ThemeControl() {
  // The server always renders light; the boot script in <head> fixes the page before paint.
  const state = useSyncExternalStore(subscribe, snapshot, () => "light:light");
  const [stored, device] = state.split(":");
  const preference = parsePreference(stored);
  const theme = resolveTheme(preference, device === "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const isDark = theme === "dark";
  return (
    <div className="theme-control">
      <button
        type="button"
        className="icon-button"
        onClick={() => choose(isDark ? "light" : "dark")}
        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        title={isDark ? "Light mode" : "Dark mode"}
      >
        <span aria-hidden="true">{isDark ? "☀" : "☾"}</span>
      </button>
      <label className="visually-hidden" htmlFor="theme-select">
        Theme
      </label>
      <select
        id="theme-select"
        value={preference}
        onChange={(e) => choose(parsePreference(e.target.value))}
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">Match device</option>
      </select>
    </div>
  );
}
