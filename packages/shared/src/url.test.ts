import { describe, expect, it } from "vitest";
import { checkMonitorUrl, isBlockedAddress } from "./url.js";

const allowed = [
  "https://example.com",
  "http://example.com:8080/health?x=1",
  "https://api.github.com/zen",
  "https://8.8.8.8/",
  "https://172.32.0.1/", // just outside 172.16.0.0/12
  "https://[2606:4700:4700::1111]/", // public IPv6
];

const blocked = [
  "http://localhost:3000",
  "http://LOCALHOST",
  "http://app.localhost",
  "http://printer.local",
  "http://db.internal",
  "http://router.home.arpa",
  "http://127.0.0.1",
  "http://127.1.2.3",
  "http://2130706433", // 127.0.0.1 as a decimal
  "http://0x7f.0.0.1", // 127.0.0.1 in hex
  "http://0.0.0.0",
  "http://10.0.0.5",
  "http://100.64.1.1",
  "http://169.254.169.254/latest/meta-data", // cloud metadata
  "http://172.16.0.1",
  "http://172.31.255.255",
  "http://192.168.1.1",
  "http://224.0.0.1",
  "http://255.255.255.255",
  "http://[::1]",
  "http://[::]",
  "http://[fc00::1]",
  "http://[fd12:3456::1]",
  "http://[fe80::1]",
  "http://[ff02::1]",
  "http://[::ffff:127.0.0.1]",
  "http://[::ffff:10.0.0.1]",
  "http://[64:ff9b::7f00:1]",
  "http://192.0.2.10", // documentation ranges
  "http://198.51.100.7",
  "http://203.0.113.200",
  "http://[2001:db8::1]",
  "http://[2002:a00:1::1]", // 6to4 wrapping 10.0.0.1
  "http://[::a00:1]", // IPv4-compatible 10.0.0.1
  "http://[100::1]",
];

describe("checkMonitorUrl", () => {
  it.each(allowed)("allows %s", (url) => {
    expect(checkMonitorUrl(url).ok).toBe(true);
  });

  it.each(blocked)("blocks %s", (url) => {
    const result = checkMonitorUrl(url);
    expect(result.ok).toBe(false);
  });

  it("rejects other schemes", () => {
    for (const url of ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)"]) {
      const result = checkMonitorUrl(url);
      expect(result.ok).toBe(false);
      expect(result.ok ? "" : result.reason).toMatch(/http/);
    }
  });

  it("rejects credentials in the URL", () => {
    expect(checkMonitorUrl("https://user:pass@example.com")).toMatchObject({ ok: false });
  });

  it("rejects single-label hostnames", () => {
    expect(checkMonitorUrl("http://intranet/")).toMatchObject({ ok: false });
  });

  it("rejects text that isn't a URL", () => {
    expect(checkMonitorUrl("example.com")).toMatchObject({ ok: false });
  });

  it("returns the normalised URL", () => {
    expect(checkMonitorUrl("  HTTPS://Example.COM  ")).toEqual({
      ok: true,
      url: "https://example.com/",
    });
  });
});

describe("isBlockedAddress", () => {
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"])(
    "allows public %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.0.10",
    "169.254.169.254",
    "100.100.100.200",
    "0.0.0.0",
    "::1",
    "::",
    "fe80::1%eth0", // zone IDs are ignored
    "fd00:ec2::254", // AWS IPv6 metadata
    "::ffff:169.254.169.254", // dotted IPv4 tail
    "::ffff:a9fe:a9fe",
    "[::1]",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["", "not-an-ip", "999.1.1.1", "1.2.3", "gggg::1"])("blocks invalid %j", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });
});
