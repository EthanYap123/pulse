import { describe, expect, it } from "vitest";
import { credentialsSchema, emailSchema, loginSchema } from "./auth.js";

describe("emailSchema", () => {
  it("trims and lowercases", () => {
    expect(emailSchema.parse("  Ethan@Example.COM ")).toBe("ethan@example.com");
  });

  it("rejects something that isn't an email", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("credentialsSchema", () => {
  it("accepts a 10-character password", () => {
    expect(credentialsSchema.safeParse({ email: "a@b.co", password: "x".repeat(10) }).success).toBe(
      true,
    );
  });

  it("rejects passwords shorter than 10 or longer than 128", () => {
    expect(credentialsSchema.safeParse({ email: "a@b.co", password: "x".repeat(9) }).success).toBe(
      false,
    );
    expect(
      credentialsSchema.safeParse({ email: "a@b.co", password: "x".repeat(129) }).success,
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("doesn't apply the sign-up length rule", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "short" }).success).toBe(true);
  });

  it("requires a password", () => {
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});
