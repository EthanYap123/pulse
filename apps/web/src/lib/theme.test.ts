import { describe, expect, it } from "vitest";
import { parsePreference, resolveTheme } from "./theme.js";

describe("theme", () => {
  it("defaults to light, whatever is stored", () => {
    expect(parsePreference(null)).toBe("light");
    expect(parsePreference("purple")).toBe("light");
  });

  it("keeps explicit choices", () => {
    expect(parsePreference("dark")).toBe("dark");
    expect(parsePreference("system")).toBe("system");
  });

  it("only follows the device when asked to", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});
