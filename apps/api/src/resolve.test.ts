import { describe, expect, it } from "vitest";
import { AppError } from "./errors.js";
import { assertPublicHost, type LookupHost } from "./resolve.js";

const resolvesTo =
  (...addresses: string[]): LookupHost =>
  () =>
    Promise.resolve(addresses);

const failsWith =
  (code: string): LookupHost =>
  () =>
    Promise.reject(Object.assign(new Error(code), { code }));

async function messageFor(url: string, lookup: LookupHost, timeoutMs?: number) {
  try {
    await assertPublicHost(url, lookup, timeoutMs);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const { status, extra } = error as AppError;
    expect(status).toBe(422);
    const [first] = (extra as { errors: { path: string; message: string }[] }).errors;
    expect(first?.path).toBe("url");
    return first?.message ?? "";
  }
}

describe("assertPublicHost", () => {
  it("accepts a hostname with only public addresses", async () => {
    expect(
      await messageFor("https://example.com/", resolvesTo("93.184.215.14", "2606:2800:21f::1")),
    ).toBeNull();
  });

  it.each([
    ["loopback", "127.0.0.1"],
    ["private", "10.0.0.5"],
    ["metadata", "169.254.169.254"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unique local", "fd00::1"],
  ])("rejects a %s address", async (_name, address) => {
    expect(await messageFor("https://evil.example/", resolvesTo(address))).toMatch(/private/);
  });

  it("rejects when any one of several addresses is private", async () => {
    expect(
      await messageFor("https://evil.example/", resolvesTo("93.184.215.14", "192.168.1.1")),
    ).toMatch(/private/);
  });

  it("rejects a hostname with no addresses", async () => {
    expect(await messageFor("https://empty.example/", resolvesTo())).toMatch(/couldn't find/);
  });

  it.each(["ENOTFOUND", "ENODATA"])("explains %s as a missing hostname", async (code) => {
    expect(await messageFor("https://nope.example/", failsWith(code))).toMatch(/couldn't find/);
  });

  it("asks to try again on other lookup errors", async () => {
    expect(await messageFor("https://flaky.example/", failsWith("ESERVFAIL"))).toMatch(
      /try again/i,
    );
  });

  it("gives up on a slow lookup", async () => {
    const never: LookupHost = () => new Promise(() => {});
    expect(await messageFor("https://slow.example/", never, 20)).toMatch(/try again/i);
  });

  it("doesn't look up IP literals, which the URL schema already checked", async () => {
    const lookup: LookupHost = () => Promise.reject(new Error("should not be called"));
    expect(await messageFor("https://93.184.215.14/", lookup)).toBeNull();
    expect(await messageFor("https://[2606:4700:4700::1111]/", lookup)).toBeNull();
  });
});
