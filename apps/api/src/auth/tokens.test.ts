import { describe, expect, it } from "vitest";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashRefreshToken,
  newRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "./tokens.js";

const SECRET = "unit-test-secret-unit-test-secret-0000";

describe("access tokens", () => {
  it("round-trips the user id", async () => {
    const token = await signAccessToken("user-1", SECRET);
    expect(await verifyAccessToken(token, SECRET)).toBe("user-1");
  });

  it("expire after 15 minutes", async () => {
    const issued = new Date("2026-10-31T00:00:00Z");
    const token = await signAccessToken("user-1", SECRET, issued);
    const justBefore = new Date(issued.getTime() + (ACCESS_TOKEN_TTL_SECONDS - 1) * 1000);
    const after = new Date(issued.getTime() + (ACCESS_TOKEN_TTL_SECONDS + 1) * 1000);
    expect(await verifyAccessToken(token, SECRET, justBefore)).toBe("user-1");
    expect(await verifyAccessToken(token, SECRET, after)).toBeNull();
  });

  it("are rejected when signed with another secret", async () => {
    const token = await signAccessToken("user-1", "another-secret-another-secret-0000");
    expect(await verifyAccessToken(token, SECRET)).toBeNull();
  });

  it("are rejected when tampered with", async () => {
    const token = await signAccessToken("user-1", SECRET);
    const [header, , signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url");
    expect(await verifyAccessToken(`${header}.${forgedPayload}.${signature}`, SECRET)).toBeNull();
  });

  it("reject garbage", async () => {
    expect(await verifyAccessToken("not-a-jwt", SECRET)).toBeNull();
  });
});

describe("refresh tokens", () => {
  it("are random and stored only as a SHA-256 hash", () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toHaveLength(32);
    expect(hashRefreshToken(a.token)).toEqual(a.hash);
  });
});
