import type { LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { REFRESH_COOKIE } from "../src/routes/auth.js";
import { testConfig } from "./helpers/config.js";
import { createTestPrisma, resetDb } from "./helpers/db.js";

const prisma = createTestPrisma();
const app = buildApp({ prisma, config: testConfig });

const EMAIL = "ethan@example.com";
const PASSWORD = "correct horse battery";

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await resetDb(prisma);
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

function refreshCookie(res: LightMyRequestResponse) {
  return res.cookies.find((c) => c.name === REFRESH_COOKIE);
}

function signup(email = EMAIL, password = PASSWORD) {
  return app.inject({ method: "POST", url: "/v1/auth/signup", payload: { email, password } });
}

function login(email = EMAIL, password = PASSWORD) {
  return app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });
}

function refresh(token: string | undefined) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/refresh",
    cookies: token ? { [REFRESH_COOKIE]: token } : {},
  });
}

function me(accessToken: string) {
  return app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

describe("sign-up", () => {
  it("creates an account, signs in and sets a refresh cookie", async () => {
    const res = await signup("  Ethan@Example.com ");
    expect(res.statusCode).toBe(201);
    const body = res.json<{ user: { email: string }; accessToken: string }>();
    expect(body.user.email).toBe(EMAIL);
    expect(body.accessToken).toEqual(expect.any(String));

    const cookie = refreshCookie(res);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/api/v1/auth" });
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
  });

  it("stores an argon2id hash, never the password", async () => {
    await signup();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it("stores only a hash of the refresh token", async () => {
    const res = await signup();
    const token = refreshCookie(res)?.value ?? "";
    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]?.tokenHash ?? []).toString("base64url")).not.toBe(token);
  });

  it("gives a vague error for an email that is already registered", async () => {
    await signup();
    const res = await signup(EMAIL.toUpperCase());
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "signup_failed" });
    expect(JSON.stringify(res.json())).not.toMatch(/exist|taken|registered/i);
  });
});

describe("login", () => {
  it("signs in with the right password", async () => {
    await signup();
    const res = await login("ETHAN@example.com");
    expect(res.statusCode).toBe(200);
    expect(refreshCookie(res)?.value).toEqual(expect.any(String));
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    await signup();
    const wrongPassword = await login(EMAIL, "wrong password here");
    const unknownEmail = await login("nobody@example.com", PASSWORD);
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknownEmail.json());
  });
});

describe("GET /v1/me", () => {
  it("returns the user with usage and limits", async () => {
    const { accessToken } = (await signup()).json<{ accessToken: string }>();
    const res = await me(accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      email: EMAIL,
      usage: { projects: 0, monitors: 0 },
      limits: { projects: 3, monitors: 10 },
    });
  });

  it("rejects an invalid token", async () => {
    expect((await me("not-a-token")).statusCode).toBe(401);
  });
});

describe("refresh", () => {
  it("rotates the token: the new one works and returns a new access token", async () => {
    const first = refreshCookie(await signup())?.value;
    const res = await refresh(first);
    expect(res.statusCode).toBe(200);
    const second = refreshCookie(res)?.value;
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);

    const { accessToken } = res.json<{ accessToken: string }>();
    expect((await me(accessToken)).statusCode).toBe(200);
    expect((await refresh(second)).statusCode).toBe(200);
  });

  it("revokes the whole family when an old token is reused", async () => {
    const first = refreshCookie(await signup())?.value;
    const second = refreshCookie(await refresh(first))?.value;

    // Someone replays the first token after it was rotated.
    const replay = await refresh(first);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toMatchObject({ code: "session_expired" });

    // The legitimate holder's newer token is now dead too.
    expect((await refresh(second)).statusCode).toBe(401);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it("leaves other sessions alone when one family is revoked", async () => {
    await signup();
    const laptop = refreshCookie(await login())?.value;
    const phone = refreshCookie(await login())?.value;
    await refresh(laptop);
    await refresh(laptop); // reuse: kills the laptop family only
    expect((await refresh(phone)).statusCode).toBe(200);
  });

  it("rejects an expired token", async () => {
    const token = refreshCookie(await signup())?.value;
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await refresh(token)).statusCode).toBe(401);
  });

  it("rejects a missing or unknown token", async () => {
    expect((await refresh(undefined)).statusCode).toBe(401);
    expect((await refresh("made-up-token")).statusCode).toBe(401);
  });

  it("issues only one new token when the same token is refreshed twice at once", async () => {
    const token = refreshCookie(await signup())?.value;
    const results = await Promise.all([refresh(token), refresh(token)]);
    const ok = results.filter((r) => r.statusCode === 200);
    expect(ok.length).toBeLessThanOrEqual(1);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBeLessThanOrEqual(1);
  });
});

describe("logout", () => {
  it("revokes the session and clears the cookie", async () => {
    const token = refreshCookie(await signup())?.value;
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      cookies: { [REFRESH_COOKIE]: token ?? "" },
    });
    expect(res.statusCode).toBe(204);
    expect(refreshCookie(res)?.value).toBe("");
    expect((await refresh(token)).statusCode).toBe(401);
  });

  it("succeeds without a cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(res.statusCode).toBe(204);
  });
});
