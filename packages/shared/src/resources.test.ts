import { describe, expect, it } from "vitest";
import {
  monitorInputSchema,
  monitorPatchSchema,
  projectInputSchema,
  projectPatchSchema,
  slugSchema,
} from "./resources.js";

describe("slugSchema", () => {
  it("lowercases and accepts letters, numbers and inner hyphens", () => {
    expect(slugSchema.parse("My-Site-2")).toBe("my-site-2");
  });

  it.each(["ab", "-abc", "abc-", "has space", "under_score", "a".repeat(41)])(
    "rejects %j",
    (slug) => {
      expect(slugSchema.safeParse(slug).success).toBe(false);
    },
  );
});

describe("projectInputSchema", () => {
  it("defaults isPublic to true", () => {
    expect(projectInputSchema.parse({ name: " Site ", slug: "site" })).toEqual({
      name: "Site",
      slug: "site",
      isPublic: true,
    });
  });

  it("rejects unknown fields", () => {
    expect(projectInputSchema.safeParse({ name: "x", slug: "site", ownerId: "y" }).success).toBe(
      false,
    );
  });
});

describe("projectPatchSchema", () => {
  it("allows clearing the status note", () => {
    expect(projectPatchSchema.parse({ statusNote: null })).toEqual({ statusNote: null });
  });
});

describe("monitorInputSchema", () => {
  it("fills in the documented defaults", () => {
    expect(monitorInputSchema.parse({ name: "Home", url: "https://example.com" })).toEqual({
      name: "Home",
      url: "https://example.com/",
      method: "GET",
      expectedStatus: { min: 200, max: 399 },
      timeoutMs: 8000,
      failureThreshold: 3,
      headers: {},
      showOnStatusPage: true,
    });
  });

  it("explains why a private URL is rejected", () => {
    const result = monitorInputSchema.safeParse({ name: "x", url: "http://192.168.0.1" });
    expect(result.success).toBe(false);
    const issue = result.error?.issues[0];
    expect(issue?.path).toEqual(["url"]);
    expect(issue?.message).toMatch(/private/i);
  });

  it("enforces timeout and threshold ranges", () => {
    const base = { name: "x", url: "https://example.com" };
    expect(monitorInputSchema.safeParse({ ...base, timeoutMs: 999 }).success).toBe(false);
    expect(monitorInputSchema.safeParse({ ...base, timeoutMs: 8001 }).success).toBe(false);
    expect(monitorInputSchema.safeParse({ ...base, failureThreshold: 6 }).success).toBe(false);
  });

  it("limits headers to 5 and blocks reserved names", () => {
    const base = { name: "x", url: "https://example.com" };
    const six = Object.fromEntries([1, 2, 3, 4, 5, 6].map((n) => [`X-H${n}`, "v"]));
    expect(monitorInputSchema.safeParse({ ...base, headers: six }).success).toBe(false);
    expect(monitorInputSchema.safeParse({ ...base, headers: { Host: "evil" } }).success).toBe(
      false,
    );
    expect(
      monitorInputSchema.safeParse({ ...base, headers: { Authorization: "Bearer t" } }).success,
    ).toBe(true);
  });
});

describe("monitorPatchSchema", () => {
  it("has no defaults, so a patch only contains what was sent", () => {
    expect(monitorPatchSchema.parse({ name: "New" })).toEqual({ name: "New" });
  });
});
