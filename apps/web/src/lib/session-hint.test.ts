import { afterEach, describe, expect, it, vi } from "vitest";
import { hasSessionHint, setSessionHint } from "./session-hint.js";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session hint", () => {
  it("is absent for a first-time visitor", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    expect(hasSessionHint()).toBe(false);
  });

  it("is remembered after signing in and forgotten after signing out", () => {
    vi.stubGlobal("localStorage", fakeStorage());
    setSessionHint(true);
    expect(hasSessionHint()).toBe(true);
    setSessionHint(false);
    expect(hasSessionHint()).toBe(false);
  });

  it("asks the API when storage is blocked, so nobody is signed out by accident", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(hasSessionHint()).toBe(true);
    expect(() => setSessionHint(true)).not.toThrow();
  });
});
