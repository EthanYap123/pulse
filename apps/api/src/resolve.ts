import { lookup } from "node:dns/promises";
import { isBlockedAddress } from "@pulse/shared";
import { AppError } from "./errors.js";

/** Resolves a hostname to every address it currently points at. */
export type LookupHost = (hostname: string) => Promise<string[]>;

export const dnsLookup: LookupHost = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

const LOOKUP_TIMEOUT_MS = 5_000;

const NOT_FOUND_CODES = new Set(["ENOTFOUND", "ENODATA", "EAI_NONAME", "EAI_NODATA"]);

/**
 * Second line of SSRF defence, after `checkMonitorUrl` in @pulse/shared: resolves the URL's
 * hostname and rejects it if any address is private, loopback, link-local or otherwise not
 * public. Run when a monitor is created or its URL changes. IP literals were already checked
 * by the URL schema, so they aren't looked up.
 *
 * A hostname could be pointed somewhere else later (DNS rebinding). That's covered by where
 * checks run: the checker is on Cloudflare, which can't reach private networks.
 */
export async function assertPublicHost(
  url: string,
  lookupHost: LookupHost,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): Promise<void> {
  const hostname = new URL(url).hostname;
  if (/^[\d.]+$/.test(hostname) || hostname.startsWith("[")) return;

  let addresses: string[];
  try {
    addresses = await withTimeout(lookupHost(hostname), timeoutMs);
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw urlError(
      typeof code === "string" && NOT_FOUND_CODES.has(code)
        ? "We couldn't find that hostname. Check the spelling."
        : "We couldn't look up that hostname right now. Try again in a minute.",
    );
  }
  if (addresses.length === 0) {
    throw urlError("We couldn't find that hostname. Check the spelling.");
  }
  if (addresses.some(isBlockedAddress)) {
    throw urlError(
      "That hostname points to a private or internal address, so it can't be monitored",
    );
  }
}

function urlError(message: string): AppError {
  return new AppError(422, "validation_failed", "Validation failed", {
    errors: [{ path: "url", message }],
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error("DNS lookup timed out"), { code: "ETIMEOUT" })),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
