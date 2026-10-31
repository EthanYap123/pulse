/**
 * First line of SSRF defence: only public http(s) URLs can be monitored. Hostnames that
 * resolve to private addresses are handled in Phase 5 (DNS checks); the checker also runs
 * on Cloudflare, which can't reach private networks.
 */

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan"];

// [network, prefix length] for IPv4 ranges that aren't publicly routable.
const BLOCKED_V4: [number, number][] = [
  [ip4(0, 0, 0, 0), 8], // "this network"
  [ip4(10, 0, 0, 0), 8], // private
  [ip4(100, 64, 0, 0), 10], // carrier-grade NAT
  [ip4(127, 0, 0, 0), 8], // loopback
  [ip4(169, 254, 0, 0), 16], // link-local, including cloud metadata (169.254.169.254)
  [ip4(172, 16, 0, 0), 12], // private
  [ip4(192, 0, 0, 0), 24], // IETF protocol assignments
  [ip4(192, 168, 0, 0), 16], // private
  [ip4(198, 18, 0, 0), 15], // benchmarking
  [ip4(224, 0, 0, 0), 4], // multicast
  [ip4(240, 0, 0, 0), 4], // reserved, including broadcast
];

function ip4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const [a, b, c, d] = parts.map(Number) as [number, number, number, number];
  if ([a, b, c, d].some((n) => n > 255)) return null;
  return ip4(a, b, c, d);
}

function isBlockedIPv4(addr: number): boolean {
  return BLOCKED_V4.some(([network, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (addr & mask) >>> 0 === network;
  });
}

/** Expands an IPv6 literal to 8 numeric groups, or null if it isn't one. */
function parseIPv6(host: string): number[] | null {
  if (!host.includes(":")) return null;
  const [head = "", tail = ""] = host.split("::");
  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const headGroups = toGroups(head);
  const tailGroups = toGroups(tail);
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0 || (!host.includes("::") && missing !== 0)) return null;
  const groups = [...headGroups, ...Array<string>(missing).fill("0"), ...tailGroups];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

function isBlockedIPv6(g: number[]): boolean {
  const [g0 = 0, , , , , g5 = 0, g6 = 0, g7 = 0] = g;
  const allZeroBefore = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroBefore(7) && (g7 === 0 || g7 === 1)) return true; // :: and ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xff00) === 0xff00) return true; // multicast ff00::/8
  const embeddedV4 = ((g6 << 16) | g7) >>> 0;
  if (allZeroBefore(5) && g5 === 0xffff) return isBlockedIPv4(embeddedV4); // ::ffff:a.b.c.d
  if (g0 === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIPv4(embeddedV4); // NAT64 64:ff9b::a.b.c.d
  }
  return false;
}

export function checkMonitorUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Enter a full URL, starting with http:// or https://" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http:// and https:// URLs can be monitored" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Remove the username and password from the URL" };
  }

  // The URL parser lowercases hosts and normalises IPv4 forms like 2130706433 or 0x7f.1.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const privateReason = "Private, local and internal addresses can't be monitored";

  const v4 = parseIPv4(host);
  if (v4 !== null) return isBlockedIPv4(v4) ? { ok: false, reason: privateReason } : ok(url);

  const v6 = parseIPv6(host);
  if (v6 !== null) return isBlockedIPv6(v6) ? { ok: false, reason: privateReason } : ok(url);

  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: privateReason };
  }
  if (!host.includes(".")) {
    return { ok: false, reason: "Use a public hostname, such as example.com" };
  }
  return ok(url);
}

function ok(url: URL): UrlCheck {
  return { ok: true, url: url.toString() };
}
