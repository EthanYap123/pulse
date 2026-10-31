import { describe, expect, it } from "vitest";
import { createCipher } from "./crypto.js";

const KEY = "11".repeat(32);

describe("createCipher", () => {
  const cipher = createCipher(KEY);

  it("round-trips text", () => {
    const stored = cipher.encrypt("Bearer abc123");
    expect(stored).toMatch(/^v1\./);
    expect(stored).not.toContain("abc123");
    expect(cipher.decrypt(stored)).toBe("Bearer abc123");
  });

  it("uses a fresh IV each time", () => {
    expect(cipher.encrypt("same")).not.toBe(cipher.encrypt("same"));
  });

  it("detects tampering", () => {
    const [v, iv, tag, ct] = cipher.encrypt("secret").split(".");
    const flipped = Buffer.from(ct ?? "", "base64url");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => cipher.decrypt([v, iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });

  it("can't be read with another key", () => {
    const stored = cipher.encrypt("secret");
    expect(() => createCipher("22".repeat(32)).decrypt(stored)).toThrow();
  });

  it("rejects a key of the wrong length", () => {
    expect(() => createCipher("abcd")).toThrow(/32 bytes/);
  });

  it("rejects values in an unknown format", () => {
    expect(() => cipher.decrypt("plain text")).toThrow(/Unrecognised/);
  });
});
