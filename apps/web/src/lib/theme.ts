/** Light by default, with an explicit dark mode and an option to follow the device. */
export type ThemePreference = "light" | "dark" | "system";
export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "pulse-theme";

export function parsePreference(value: string | null | undefined): ThemePreference {
  return value === "dark" || value === "system" ? value : "light";
}

export function resolveTheme(preference: ThemePreference, deviceIsDark: boolean): Theme {
  if (preference === "system") return deviceIsDark ? "dark" : "light";
  return preference;
}

/**
 * Runs before the page paints (inlined in <head>) so there's no flash of the wrong theme.
 * Kept as a string because it can't import anything.
 */
export const themeBootScript = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var t=p==="dark"||(p==="system"&&d)?"dark":"light";document.documentElement.dataset.theme=t;}catch(e){document.documentElement.dataset.theme="light";}})();`;
